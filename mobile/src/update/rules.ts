/**
 * When the app looks for an update and what it accepts as one — pure, so the
 * decisions are tested without a phone. UpdateProvider does the I/O.
 */

/** How often the app asks on its own: at start, and on returning to it after this long. */
export const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** The newest published build, as GET /api/mobile/releases/latest describes it. */
export interface Release {
  version: string;
  version_code: number;
  sha256: string;
  size_bytes: number;
  notes: string;
  download_url: string;
}

/** Whether to ask the server now. `force` is the account menu's "Check for updates". */
export function shouldCheck(lastCheckedAt: number | null, now: number, force = false): boolean {
  if (force || lastCheckedAt === null) return true;
  return now - lastCheckedAt >= UPDATE_CHECK_EVERY_MS || now < lastCheckedAt;
}

/**
 * The server's answer, checked field by field before the app acts on it: a
 * build only counts as an update when it is newer than the running one, its
 * digest is a sha256, and its link is https (http only in development, where
 * the server is on the Mac).
 */
export function parseRelease(
  body: unknown,
  installedCode: number,
  { allowHttp = false }: { allowHttp?: boolean } = {}
): Release | null {
  const r = (body as { release?: unknown } | null)?.release as Partial<Release> | null | undefined;
  if (!r || typeof r !== "object") return null;
  if (typeof r.version !== "string" || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r.version)) return null;
  if (typeof r.version_code !== "number" || !Number.isInteger(r.version_code)) return null;
  if (typeof r.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(r.sha256)) return null;
  if (typeof r.size_bytes !== "number" || r.size_bytes <= 0) return null;
  if (typeof r.download_url !== "string") return null;
  const scheme = r.download_url.split(":", 1)[0];
  if (scheme !== "https" && !(allowHttp && scheme === "http")) return null;
  if (r.version_code <= installedCode) return null;
  return {
    version: r.version,
    version_code: r.version_code,
    sha256: r.sha256,
    size_bytes: r.size_bytes,
    notes: typeof r.notes === "string" ? r.notes : "",
    download_url: r.download_url,
  };
}

/** The download's file name in cache/updates/, from validated fields only. */
export function updateFileName(release: Pick<Release, "version" | "version_code">): string {
  return `book-${release.version}-${release.version_code}.apk`;
}

/** "54 MB", for the prompt. */
export function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

/** What the account sheet says under "Check for updates", from the updater's state. */
export function updateLine(
  state:
    | { status: "idle" }
    | { status: "available"; release: Pick<Release, "version" | "size_bytes"> }
    | { status: "downloading"; release: Pick<Release, "version">; progress: number }
    | { status: "ready"; release: Pick<Release, "version"> }
    | { status: "failed"; release: Pick<Release, "version">; message: string },
  installed: { name: string; code: number }
): string {
  switch (state.status) {
    case "available":
      return `${state.release.version} is available (${formatSize(state.release.size_bytes)})`;
    case "downloading":
      return `Downloading ${state.release.version}… ${Math.round(state.progress * 100)}%`;
    case "ready":
      return `${state.release.version} is ready to install`;
    case "failed":
      return state.message;
    default:
      return `Version ${installed.name} (${installed.code})`;
  }
}
