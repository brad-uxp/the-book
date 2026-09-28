/**
 * What a row from the server does to the phone's copy — from a pull, or from
 * the answer to a push. Pure, like outbox.ts.
 *
 * The one rule: the server's row replaces the phone's, except for the fields
 * a queued change will still set. Those stay as the phone has them — they are
 * what the person is looking at, and the push will reconcile them (the server
 * decides conflicts, not the phone).
 */
import type { SyncIssueRow, SyncResult } from "../../../lib/sync-protocol.ts";
import { hasPendingDelete, pendingFields, type PendingMutation } from "./outbox.ts";
import { searchText } from "../notes/text.ts";

/** An issue as the phone stores it. */
export interface LocalIssue extends SyncIssueRow {
  /** The server's `updated_at` this copy is based on; null until the server has confirmed the row. */
  server_updated_at: string | null;
  /** 0 while a new note is still empty: nothing has been queued for the server yet. */
  announced: 0 | 1;
  /** When it was deleted on the phone (ms); hidden, waiting out the Undo and the push. */
  deleted_at: number | null;
  /** Why the server refused the last change to it, when it did. */
  sync_error: string | null;
  /** Folded title + text, for local search. */
  search: string;
}

const ISSUE_FIELDS = [
  "title",
  "client_id",
  "category",
  "note_format",
  "status",
  "progress",
  "due_date",
  "description",
  "sort_order",
] as const;

/**
 * The phone's copy after a server row arrives, or "skip" when the row must
 * not be touched: a delete is queued for it, and the push will settle it.
 */
export function mergeIssue(
  local: LocalIssue | null,
  server: SyncIssueRow,
  queue: PendingMutation[]
): LocalIssue | "skip" {
  if (hasPendingDelete(queue)) return "skip";

  const keep = pendingFields(queue);
  const merged: LocalIssue = {
    ...server,
    server_updated_at: server.updated_at,
    announced: 1,
    deleted_at: local?.deleted_at ?? null,
    sync_error: keep.size > 0 ? (local?.sync_error ?? null) : null,
    search: "",
  };

  if (local && keep.size > 0) {
    for (const field of ISSUE_FIELDS) {
      if (keep.has(field)) (merged as unknown as Record<string, unknown>)[field] = local[field];
    }
    // "Edited" is the latest of the two: the phone's edit is newer than the
    // server's row until the push lands.
    if (Date.parse(local.updated_at) > Date.parse(server.updated_at)) merged.updated_at = local.updated_at;
  }

  merged.search = searchText(merged.title, merged.description);
  return merged;
}

export type ResultEffect =
  /** Put this row in place of the phone's copy (merged with what is still queued). */
  | { kind: "row"; row: SyncIssueRow; restore: boolean }
  /** The row is gone on the server: drop it — unless more changes are queued for it. */
  | { kind: "drop" }
  /** The server refused a row it does not have: keep the phone's words, flag the note. */
  | { kind: "flag"; reason: string }
  | { kind: "none" };

/**
 * What an answer from the server does to the phone's copy of the row. The
 * answered change has already left the queue; `queue` is what remains for
 * the row.
 */
export function resultEffect(
  result: SyncResult,
  op: "upsert" | "delete",
  queue: PendingMutation[]
): ResultEffect {
  const row = (result.row ?? null) as SyncIssueRow | null;

  if (result.status === "deleted") return queue.length ? { kind: "none" } : { kind: "drop" };

  if (result.status === "rejected") {
    // A refused delete (the text had changed on the server) brings the row
    // back; a refused edit puts the server's version back.
    if (row) return { kind: "row", row, restore: op === "delete" };
    return op === "upsert" ? { kind: "flag", reason: result.reason ?? "rejected" } : { kind: "none" };
  }

  // applied or conflict_copy (the copy itself arrives with the next pull).
  if (row) return { kind: "row", row, restore: false };
  if (op === "delete" || result.reason === "deleted_on_server") {
    return queue.length ? { kind: "none" } : { kind: "drop" };
  }
  return { kind: "none" };
}
