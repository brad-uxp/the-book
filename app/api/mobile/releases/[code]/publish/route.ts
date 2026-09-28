import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireReleaseToken, toApiResponse } from "@/lib/api";
import { decidePublish } from "@/lib/mobile-releases";
import { releaseObjectSize } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * Offers an uploaded build to the phone. Only once R2 holds exactly the bytes
 * the release script declared, so the phone never sees a half-uploaded file.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const denied = await requireReleaseToken();
  if (denied) return denied;

  const { code } = await params;
  if (!/^\d{1,9}$/.test(code)) return NextResponse.json({ error: "Invalid versionCode" }, { status: 400 });

  try {
    const release = await prisma.mobileRelease.findUnique({ where: { version_code: Number(code) } });
    const stored = release ? await releaseObjectSize(release.r2_key) : null;
    const decision = decidePublish(
      release ? { published: release.published_at !== null, size_bytes: release.size_bytes } : null,
      stored
    );
    if (decision.action === "reject") {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    // Conditional on still being unpublished: two publishes racing leave one.
    const updated = await prisma.mobileRelease.updateMany({
      where: { id: release!.id, published_at: null },
      data: { published_at: new Date() },
    });
    if (updated.count === 0) return NextResponse.json({ error: "Already published" }, { status: 409 });

    auditLog({
      entity_type: "mobile_release",
      entity_id: release!.id,
      entity_name: `${release!.version} (${release!.version_code})`,
      action: "update",
      actor_email: await getActorEmail(),
      after: { published: true },
    });

    return NextResponse.json({ version: release!.version, version_code: release!.version_code, published: true });
  } catch (err) {
    return toApiResponse(err);
  }
}
