/**
 * The queue of changes the phone has made and the server has not answered
 * yet, and how a new change joins it.
 *
 * Pure (no React Native), so `node --test` runs it; the SQL lives in
 * src/db/repo.ts. The server's side of the same protocol is lib/sync.ts.
 */
import type { SyncEntity } from "../../../lib/sync-protocol.ts";

export interface PendingMutation {
  seq: number;
  mutation_id: string;
  entity: SyncEntity;
  op: "upsert" | "delete";
  entity_id: string;
  /** Only what changed. */
  fields: Record<string, unknown>;
  base_updated_at: string | null;
  base_hash: string | null;
  title_hint: string | null;
  /** How many pushes have carried it. Once sent, it never changes again. */
  attempts: number;
}

export interface Change {
  fields: Record<string, unknown>;
  base_updated_at: string | null;
  /** sha256 of the text the edit started from, when the text changed. */
  base_hash: string | null;
  title_hint?: string | null;
}

export type Coalesced =
  | { action: "merge"; fields: Record<string, unknown>; base_hash: string | null; title_hint: string | null }
  | { action: "append" };

/**
 * Whether a new edit of a row folds into the last change queued for it.
 *
 * Only an upsert that was never sent can absorb it. Once a push has carried a
 * change, the server may already have applied it and kept its answer under
 * that mutation id — a retry returns that stored answer, so anything folded in
 * afterwards would be silently dropped.
 *
 * The folded change keeps the FIRST base: the server's text the whole run of
 * edits started from, which is what a conflict has to be judged against.
 */
export function coalesce(last: PendingMutation | null, change: Change): Coalesced {
  if (!last || last.op !== "upsert" || last.attempts > 0) return { action: "append" };
  const textBefore = "description" in last.fields || "content" in last.fields;
  return {
    action: "merge",
    fields: { ...last.fields, ...change.fields },
    base_hash: textBefore ? last.base_hash : (change.base_hash ?? last.base_hash),
    title_hint: change.title_hint ?? last.title_hint,
  };
}

/** The fields some queued change will still set — a pulled row must not overwrite them. */
export function pendingFields(queue: PendingMutation[]): Set<string> {
  const out = new Set<string>();
  for (const m of queue) {
    if (m.op === "upsert") for (const key of Object.keys(m.fields)) out.add(key);
  }
  return out;
}

export function hasPendingDelete(queue: PendingMutation[]): boolean {
  return queue.some((m) => m.op === "delete");
}

/** The keys of `patch` whose value is not already the row's. */
export function changedFields<T extends object>(row: T, patch: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] !== undefined && patch[key] !== row[key]) out[key] = patch[key];
  }
  return out;
}

/** Retry delays after failed syncs: 5 s, 10 s, 20 s… capped at five minutes. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(5 * 60_000, 5_000 * 2 ** (failures - 1));
}
