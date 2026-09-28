import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useLiveQuery } from "@/db/database";
import { clearBusinessCache } from "@/business/snapshots";
import { setLocalWriteListener } from "@/notes/store";
import { SyncEngine, type SyncStatus } from "./engine";

/**
 * Runs the sync engine while signed in, and tells the screens how it is going.
 */

interface SyncContextValue {
  status: SyncStatus;
  /** Changes on this phone the server has not answered yet. */
  pending: number;
  /** A run now — for pull-to-refresh. Resolves when it is done. */
  syncNow: () => Promise<void>;
}

const IDLE: SyncStatus = { online: true, syncing: false, lastSyncedAt: null, error: null, conflictCopies: 0 };

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside <SyncProvider>");
  return ctx;
}

/** Push this long after the last local change: typing is many changes, one push. */
const PUSH_DELAY_MS = 2000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { state, expire } = useAuth();
  const token = state.status === "signed-in" ? state.token : null;
  const [status, setStatus] = useState<SyncStatus>(IDLE);
  const engine = useRef<SyncEngine | null>(null);

  useEffect(() => {
    if (!token) return;
    const e = new SyncEngine(token, () => void expire());
    engine.current = e;
    const off = e.subscribe(setStatus);
    setLocalWriteListener(() => e.schedule(PUSH_DELAY_MS));
    e.start();
    return () => {
      off();
      setLocalWriteListener(() => undefined);
      e.stop();
      engine.current = null;
      setStatus(IDLE);
    };
  }, [token, expire]);

  // However the session ends — a 401 seen by the sync, by a business screen,
  // or signing out — the invoices, salaries and metrics snapshots go with it.
  const signedOut = state.status === "signed-out";
  useEffect(() => {
    if (signedOut) void clearBusinessCache().catch((err) => console.warn("[auth] clear business cache", err));
  }, [signedOut]);

  const pending =
    useLiveQuery(["outbox"], async (db) => (await db.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM outbox"))?.n ?? 0, []) ?? 0;

  const syncNow = useCallback(async () => {
    await engine.current?.syncNow({ refs: true });
  }, []);

  return <SyncContext.Provider value={{ status, pending, syncNow }}>{children}</SyncContext.Provider>;
}
