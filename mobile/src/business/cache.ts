import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useLiveQuery } from "@/db/database";
import { clearBusinessCache, saveCached } from "./snapshots";
import { ApiError, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSync } from "@/sync/SyncProvider";

export { clearBusinessCache, saveCached };

/**
 * What the Invoices, Salaries and Metrics tabs show: the last answer each got
 * from the API, kept in SQLite (table business_cache) so it is there without
 * signal — with the time it was fetched, which the screen shows.
 *
 * Unlike notes, none of this is written on the phone first: actions (mark an
 * invoice paid, register a payment) go straight to the API, and the screen
 * re-reads the server after them.
 */

interface CacheRow {
  payload: unknown;
  fetchedAt: string;
}

/** The snapshot under `key` — tagged with the key it was read for, null if there is none. */
function useCacheRow(key: string): { key: string; row: CacheRow | null } | undefined {
  return useLiveQuery(
    ["business_cache"],
    async (db) => {
      const found = await db.getFirstAsync<{ payload: string; fetched_at: string }>(
        "SELECT payload, fetched_at FROM business_cache WHERE key = ?",
        [key]
      );
      if (!found) return { key, row: null };
      try {
        return { key, row: { payload: JSON.parse(found.payload) as unknown, fetchedAt: found.fetched_at } };
      } catch {
        return { key, row: null };
      }
    },
    [key]
  );
}

/**
 * When an action last made a snapshot wrong, by key or by prefix ending in
 * ":" — `invalidate("invoices", "metrics:")` after marking an invoice paid.
 * A snapshot fetched before that is refetched the next time its screen comes
 * into view, however recent it is.
 */
const invalidations = new Map<string, number>();

export function invalidate(...keys: string[]): void {
  const now = Date.now();
  for (const k of keys) invalidations.set(k, now);
}

function invalidatedSince(key: string, fetchedAtMs: number): boolean {
  for (const [k, at] of invalidations) {
    if ((k === key || (k.endsWith(":") && key.startsWith(k))) && at >= fetchedAtMs) return true;
  }
  return false;
}

/** A snapshot younger than this is not refetched just because the screen came into view. */
const FRESH_MS = 30_000;

export interface Remote<T> {
  /** The last answer, or undefined while the phone has none yet. */
  data: T | undefined;
  /** When `data` was fetched (ISO), null if never. */
  fetchedAt: string | null;
  /** Nothing read from the phone yet (the first frame). */
  loading: boolean;
  refreshing: boolean;
  /** Why the last refresh failed; the old snapshot stays on screen. */
  error: string | null;
  online: boolean;
  /** Fetch now, whatever the snapshot's age. */
  refresh: () => Promise<void>;
}

/**
 * One API resource behind a screen: its snapshot, refreshed when the screen
 * comes into view (unless fresh), when the phone comes back online, and on
 * pull-to-refresh. `parse` checks and trims the answer before it is kept.
 */
export function useRemote<T>(key: string, path: string, parse: (raw: unknown) => T): Remote<T> {
  const read = useCacheRow(key);
  // The live query keeps its last value while a new key loads: never show one
  // key's snapshot under another's title.
  const current = read && read.key === key ? read.row : undefined;

  const { state, expire } = useAuth();
  const token = state.status === "signed-in" ? state.token : null;
  const { status } = useSync();
  const online = status.online;

  const [refreshing, setRefreshing] = useState(false);
  // Tagged with its key: switching to another period must not carry the old error.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const inflight = useRef<string | null>(null);
  const fetchedAt = useRef<{ key: string; at: string } | null>(null);
  useEffect(() => {
    fetchedAt.current = current ? { key, at: current.fetchedAt } : null;
  }, [current, key]);

  const load = useCallback(
    async (force: boolean) => {
      if (!token || inflight.current === key) return;
      const known = fetchedAt.current?.key === key ? Date.parse(fetchedAt.current.at) : null;
      if (!force && known !== null && Date.now() - known < FRESH_MS && !invalidatedSince(key, known)) return;
      inflight.current = key;
      setRefreshing(true);
      setFailure(null);
      try {
        const raw = await apiRequest<unknown>(path, { token });
        await saveCached(key, parse(raw));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await clearBusinessCache().catch(() => undefined);
          await expire();
          return;
        }
        setFailure({ key, message: err instanceof Error ? err.message : "Couldn't refresh" });
      } finally {
        if (inflight.current === key) inflight.current = null;
        setRefreshing(false);
      }
    },
    [token, key, path, parse, expire]
  );

  useFocusEffect(
    useCallback(() => {
      if (online) void load(false);
    }, [online, load])
  );

  return {
    data: current ? (current.payload as T) : undefined,
    fetchedAt: current ? current.fetchedAt : null,
    loading: current === undefined,
    refreshing,
    error: failure && failure.key === key ? failure.message : null,
    online,
    refresh: () => load(true),
  };
}

/**
 * A call to the API for an action (mark paid, register a payment): the
 * session's token, readable errors, and a 401 handled like the sync does —
 * the token is dropped and the business snapshots with it.
 */
export function useApiCall() {
  const { state, expire } = useAuth();
  const token = state.status === "signed-in" ? state.token : null;
  return useCallback(
    async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      if (!token) throw new Error("You're signed out.");
      try {
        return await apiRequest<T>(path, { token, ...init });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await clearBusinessCache().catch(() => undefined);
          await expire();
          throw new Error("Your session ended. Sign in again.");
        }
        throw err;
      }
    },
    [token, expire]
  );
}

