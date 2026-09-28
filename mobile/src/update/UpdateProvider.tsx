import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AppState } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { canInstallUpdates, installedVersion, installUpdate, openInstallSettings, sha256OfUpdate, verifyUpdate } from "../../modules/app-update";
import { getDb } from "@/db/database";
import { getMeta, setMeta } from "@/db/repo";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { parseRelease, shouldCheck, updateFileName, type Release, refusedUpdateMessage } from "./rules";

/**
 * In-app updates. The app asks GET /api/mobile/releases/latest at start and on
 * returning to it (at most every 6 h), and when the owner taps "Check for
 * updates". A newer build is downloaded into cache/updates/, its sha256 is
 * compared with the published one, and it is handed to Android's installer —
 * which asks the owner to confirm, and installs only an APK signed with the
 * same key as this app.
 */

export type UpdateState =
  | { status: "idle" }
  | { status: "available"; release: Release }
  | { status: "downloading"; release: Release; progress: number }
  | { status: "ready"; release: Release; fileUri: string }
  | { status: "failed"; release: Release; message: string };

interface UpdateContextValue {
  state: UpdateState;
  installed: { name: string; code: number };
  /** Hidden by the owner until the next start; the account menu still offers it. */
  dismissed: boolean;
  check: (force?: boolean) => Promise<"available" | "current" | "error">;
  download: () => Promise<void>;
  install: () => void;
  dismiss: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdate must be used inside <UpdateProvider>");
  return ctx;
}

const CHECKED_AT = "update.checked_at";

function updatesFolder(): Directory {
  return new Directory(Paths.cache, "updates");
}

/** Anything downloaded before this start is either installed or stale. */
function clearDownloads(): void {
  try {
    const folder = updatesFolder();
    if (folder.exists) folder.delete();
  } catch (err) {
    console.warn("[update] clear", err);
  }
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { state: auth } = useAuth();
  const token = auth.status === "signed-in" ? auth.token : null;
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const installed = useMemo(() => installedVersion(), []);
  const busy = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(clearDownloads, []);

  const fetchLatest = useCallback(async (): Promise<Release | null> => {
    const body = await apiRequest<unknown>("/api/mobile/releases/latest", { token });
    return parseRelease(body, installed.code, { allowHttp: __DEV__ });
  }, [token, installed.code]);

  const check = useCallback(
    async (force = false): Promise<"available" | "current" | "error"> => {
      if (!token || busy.current) return "current";
      const db = await getDb();
      const last = Number(await getMeta(db, CHECKED_AT)) || null;
      if (!shouldCheck(last, Date.now(), force)) {
        return stateRef.current.status === "idle" ? "current" : "available";
      }
      try {
        const release = await fetchLatest();
        await setMeta(db, CHECKED_AT, String(Date.now()));
        const cur = stateRef.current;
        if (!release) {
          if (cur.status === "available" || cur.status === "failed") setState({ status: "idle" });
          return "current";
        }
        // A download of this same build under way or done stays as it is.
        const same = cur.status !== "idle" && cur.release.version_code === release.version_code;
        if (!same || cur.status === "failed") setState({ status: "available", release });
        if (force) setDismissed(false);
        return "available";
      } catch (err) {
        console.warn("[update] check", err);
        return "error";
      }
    },
    [token, fetchLatest]
  );

  // At start, and on coming back to the app.
  useEffect(() => {
    if (!token) return;
    const first = setTimeout(() => void check(), 0);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void check();
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, [token, check]);

  const install = useCallback(() => {
    const cur = stateRef.current;
    if (cur.status !== "ready") return;
    if (!canInstallUpdates()) {
      Alert.alert(
        "Allow updates from book.",
        "Android asks once: turn on “Allow from this source” for book., come back, and tap Install again.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open settings", onPress: openInstallSettings },
        ]
      );
      return;
    }
    try {
      installUpdate(cur.fileUri);
    } catch (err) {
      console.warn("[update] install", err);
      // The native side re-checks package and key before opening the installer.
      const notThisApp = (err as { code?: unknown } | null)?.code === "ERR_NOT_THIS_APP";
      if (notThisApp) {
        try {
          new File(cur.fileUri).delete();
        } catch {
          // Cleared at the next start anyway (clearDownloads).
        }
      }
      setState({
        status: "failed",
        release: cur.release,
        message: notThisApp ? refusedUpdateMessage("wrong_signer")! : "Android couldn't open the installer. Try again.",
      });
    }
  }, []);

  const download = useCallback(async () => {
    const cur = stateRef.current;
    if (cur.status !== "available" && cur.status !== "failed") return;
    if (busy.current) return;
    busy.current = true;
    try {
      // The link in hand may have expired (it lasts 15 min): ask again.
      const release = (await fetchLatest().catch(() => null)) ?? cur.release;
      setState({ status: "downloading", release, progress: 0 });

      const folder = updatesFolder();
      if (folder.exists) folder.delete();
      folder.create({ intermediates: true });
      const target = new File(folder, updateFileName(release));
      const file = await File.downloadFileAsync(release.download_url, target, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          const total = totalBytes > 0 ? totalBytes : release.size_bytes;
          setState({ status: "downloading", release, progress: Math.min(1, bytesWritten / total) });
        },
      });

      const digest = await sha256OfUpdate(file.uri);
      if (digest !== release.sha256) {
        file.delete();
        setState({ status: "failed", release, message: "The download was damaged. Try again." });
        return;
      }
      // The hash only proves the file is the one published. Whether it is
      // book., signed with this app's key, is checked on the file itself.
      const refused = refusedUpdateMessage(await verifyUpdate(file.uri));
      if (refused) {
        file.delete();
        setState({ status: "failed", release, message: refused });
        return;
      }
      setState({ status: "ready", release, fileUri: file.uri });
      // The owner asked for this download; offer the install wherever they are now.
      Alert.alert(`book. ${release.version} is ready`, "Install it now? Android will ask you to confirm.", [
        { text: "Later", style: "cancel" },
        { text: "Install", onPress: install },
      ]);
    } catch (err) {
      console.warn("[update] download", err);
      const release = stateRef.current.status === "idle" ? cur.release : stateRef.current.release;
      setState({ status: "failed", release, message: "The download didn't finish. Check your connection and try again." });
    } finally {
      busy.current = false;
    }
  }, [fetchLatest, install]);

  const value = useMemo<UpdateContextValue>(
    () => ({ state, installed, dismissed, check, download, install, dismiss: () => setDismissed(true) }),
    [state, installed, dismissed, check, download, install]
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}
