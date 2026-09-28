/**
 * Rules for the Android app's in-app updates, pure and tested. The routes
 * under /api/mobile/releases apply them; the release script and the phone
 * rely on the same shapes.
 *
 * Integrity, in order of strength: Android installs an update only if it is
 * signed with the same key as the installed app, so a swapped file cannot
 * replace book. with something else; the phone also checks the download's
 * sha256 against the one published here, which catches a corrupted or
 * truncated file before the installer ever sees it.
 */

/** Largest APK accepted. Today's builds are ~50–120 MB. */
export const RELEASE_MAX_BYTES = 300 * 1024 * 1024;

/** How long the release script has to upload once a release is created. */
export const RELEASE_UPLOAD_URL_SECONDS = 15 * 60;

/** How long the phone has to start downloading the latest release. */
export const RELEASE_DOWNLOAD_URL_SECONDS = 15 * 60;

/** Content type of an APK, as R2 stores and serves it. */
export const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^mobile\/releases\/book-\d{1,3}\.\d{1,3}\.\d{1,3}-\d{1,9}\.apk$/;

export function isReleaseVersion(version: string): boolean {
  return VERSION_RE.test(version);
}

export function isSha256Hex(value: string): boolean {
  return SHA256_RE.test(value);
}

/** Where a build lives in R2. Built only from validated version fields. */
export function releaseKey(version: string, versionCode: number): string {
  return `mobile/releases/book-${version}-${versionCode}.apk`;
}

/** The only object keys the release routes may sign URLs for or inspect. */
export function isReleaseKey(key: string): boolean {
  return KEY_RE.test(key);
}

/**
 * How far above the latest published build a new versionCode may jump. Real
 * releases go up by one; a stolen release token could otherwise publish
 * 999999999 and park every later legitimate build behind it. Recovery, if it
 * ever happens: revoke the token in Settings and delete the rogue
 * MobileRelease row (and its R2 object).
 */
export const RELEASE_MAX_CODE_STEP = 100;

export type CreateDecision =
  | { action: "create" }
  | { action: "retry"; id: string }
  | { action: "reject"; status: 400 | 409; error: string };

/**
 * Whether a new build may be registered. versionCode must be strictly above
 * every published build — Android refuses to "update" to a lower one, and an
 * equal one would silently replace a published file. A row created earlier
 * with the same code but never published (an upload that failed) is reused,
 * so the release script can simply run again.
 */
export function decideCreate(
  versionCode: number,
  latestPublishedCode: number | null,
  existing: { id: string; published: boolean } | null
): CreateDecision {
  if (latestPublishedCode !== null && versionCode <= latestPublishedCode) {
    return {
      action: "reject",
      status: 409,
      error: `versionCode must be above the latest published build (${latestPublishedCode})`,
    };
  }
  if (latestPublishedCode !== null && versionCode - latestPublishedCode > RELEASE_MAX_CODE_STEP) {
    return {
      action: "reject",
      status: 400,
      error: `versionCode may be at most ${RELEASE_MAX_CODE_STEP} above the latest published build (${latestPublishedCode})`,
    };
  }
  if (existing?.published) {
    return { action: "reject", status: 409, error: "This versionCode is already published" };
  }
  if (existing) return { action: "retry", id: existing.id };
  return { action: "create" };
}

export type PublishDecision =
  | { action: "publish" }
  | { action: "reject"; status: 404 | 409; error: string };

/**
 * Whether an uploaded build may be published: it must exist, not be published
 * yet, and R2 must hold exactly the number of bytes the script declared.
 */
export function decidePublish(
  release: { published: boolean; size_bytes: number } | null,
  storedBytes: number | null
): PublishDecision {
  if (!release) return { action: "reject", status: 404, error: "No such release" };
  if (release.published) return { action: "reject", status: 409, error: "Already published" };
  if (storedBytes === null) {
    return { action: "reject", status: 409, error: "The APK has not been uploaded yet" };
  }
  if (storedBytes !== release.size_bytes) {
    return {
      action: "reject",
      status: 409,
      error: `Uploaded ${storedBytes} bytes, expected ${release.size_bytes}`,
    };
  }
  return { action: "publish" };
}
