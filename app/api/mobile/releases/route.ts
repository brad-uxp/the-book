import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLog, getActorEmail } from "@/lib/audit";
import { invalid, readJsonLimited, requireReleaseToken, toApiResponse } from "@/lib/api";
import { decideCreate, RELEASE_UPLOAD_URL_SECONDS, releaseKey } from "@/lib/mobile-releases";
import { getReleaseUploadUrl } from "@/lib/r2";
import { MobileReleaseCreateSchema } from "@/lib/validations";

export const runtime = "nodejs";

/** A registration is a few fields; anything bigger is refused unread. */
const BODY_MAX_BYTES = 4 * 1024;

/**
 * Registers a build of the Android app and hands back where to upload it.
 * Called by mobile/scripts/publish-release.sh with a release token. The build
 * is not offered to the phone until POST …/[code]/publish confirms the upload.
 */
export async function POST(req: NextRequest) {
  const denied = await requireReleaseToken();
  if (denied) return denied;

  const body = await readJsonLimited(req, BODY_MAX_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Body too large" : "Invalid JSON" },
      { status: body.reason === "too_large" ? 413 : 400 }
    );
  }
  const parsed = MobileReleaseCreateSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  try {
    const [latest, existing] = await Promise.all([
      prisma.mobileRelease.findFirst({
        where: { published_at: { not: null } },
        orderBy: { version_code: "desc" },
        select: { version_code: true },
      }),
      prisma.mobileRelease.findUnique({
        where: { version_code: input.version_code },
        select: { id: true, published_at: true },
      }),
    ]);

    const decision = decideCreate(
      input.version_code,
      latest?.version_code ?? null,
      existing ? { id: existing.id, published: existing.published_at !== null } : null
    );
    if (decision.action === "reject") {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    const key = releaseKey(input.version, input.version_code);
    const data = {
      version: input.version,
      version_code: input.version_code,
      sha256: input.sha256,
      size_bytes: input.size_bytes,
      notes: input.notes,
      r2_key: key,
    };
    const release =
      decision.action === "retry"
        ? await prisma.mobileRelease.update({ where: { id: decision.id }, data })
        : await prisma.mobileRelease.create({ data });

    const uploadUrl = await getReleaseUploadUrl(key, input.size_bytes, RELEASE_UPLOAD_URL_SECONDS);

    auditLog({
      entity_type: "mobile_release",
      entity_id: release.id,
      entity_name: `${release.version} (${release.version_code})`,
      action: "create",
      actor_email: await getActorEmail(),
      after: { version: release.version, version_code: release.version_code, size_bytes: release.size_bytes, sha256: release.sha256 },
    });

    return NextResponse.json(
      {
        version: release.version,
        version_code: release.version_code,
        upload_url: uploadUrl,
        upload_expires_in: RELEASE_UPLOAD_URL_SECONDS,
      },
      { status: decision.action === "retry" ? 200 : 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return toApiResponse(err);
  }
}
