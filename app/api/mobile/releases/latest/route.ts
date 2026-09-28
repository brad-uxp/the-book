import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppSession, toApiResponse } from "@/lib/api";
import { RELEASE_DOWNLOAD_URL_SECONDS } from "@/lib/mobile-releases";
import { getReleaseDownloadUrl } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * The newest published build, for the phone's "update available" check, with
 * a short-lived link to download it. `{ release: null }` before the first one.
 * The phone compares version_code with its own and checks sha256 after the
 * download; Android then refuses anything not signed with the app's key.
 */
export async function GET() {
  const denied = await requireAppSession();
  if (denied) return denied;

  try {
    const release = await prisma.mobileRelease.findFirst({
      where: { published_at: { not: null } },
      orderBy: { version_code: "desc" },
    });
    if (!release) {
      return NextResponse.json({ release: null }, { headers: { "Cache-Control": "no-store" } });
    }
    const downloadUrl = await getReleaseDownloadUrl(release.r2_key, RELEASE_DOWNLOAD_URL_SECONDS);
    return NextResponse.json(
      {
        release: {
          version: release.version,
          version_code: release.version_code,
          sha256: release.sha256,
          size_bytes: release.size_bytes,
          notes: release.notes,
          published_at: release.published_at,
          download_url: downloadUrl,
          download_expires_in: RELEASE_DOWNLOAD_URL_SECONDS,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return toApiResponse(err);
  }
}
