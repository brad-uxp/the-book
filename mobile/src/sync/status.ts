/**
 * The sync state in words, for the header badge and the account sheet. Pure.
 */
import { relativeTime } from "../lib/format.ts";

/** "just now", "2 min ago", "3 h ago", "2 d ago", then a date. */
export function syncedAgo(at: number, now: Date): string {
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))} d ago`;
  return `on ${relativeTime(new Date(at).toISOString(), now)}`;
}

export interface StatusLike {
  online: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
}

function changes(n: number): string {
  return n === 1 ? "1 change" : `${n} changes`;
}

export function syncSummary(s: StatusLike, pending: number, now: Date): string {
  const waiting = pending > 0 ? ` ${changes(pending)} waiting to sync.` : "";
  if (!s.online) return `Offline. Your notes are on this phone and sync when you're back online.${waiting}`;
  if (s.syncing) return `Syncing…${waiting}`;
  if (s.error) return `Couldn't sync: ${s.error} Retrying soon.${waiting}`;
  if (s.lastSyncedAt === null) return `Not synced yet.${waiting}`;
  return `Synced ${syncedAgo(s.lastSyncedAt, now)}.${waiting}`;
}
