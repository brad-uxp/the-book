/**
 * What a row from the server does to the phone's copy — from a pull, or from
 * the answer to a push. Pure, like outbox.ts.
 *
 * The one rule: the server's row replaces the phone's, except for the fields
 * a queued change will still set. Those stay as the phone has them — they are
 * what the person is looking at, and the push will reconcile them (the server
 * decides conflicts, not the phone).
 */
import type { SyncIssueRow, SyncNodeRow, SyncResult } from "../../../lib/sync-protocol.ts";
import { ISSUE_TITLE_MAX } from "../../../lib/text-limits.ts";
import { hasPendingDelete, pendingFields, type PendingMutation } from "./outbox.ts";
import { effectiveTitle, isBlankHtml, searchText } from "../notes/text.ts";

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

/**
 * `sync_error` of a note whose text is too long for the server. Unlike a
 * refusal, it is the phone's own verdict: the text was never sent, and it
 * stays here — a server row must not replace it — until it is shortened.
 */
export const TEXT_TOO_LONG = "too_long";

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
  if (local?.sync_error === TEXT_TOO_LONG) keep.add("description");
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

/**
 * A note holding the phone's words from a change the server refused, when
 * refusing it would otherwise lose them: the server's row is about to take
 * the place of the phone's copy, and it does not have those words. Null when
 * nothing would be lost.
 *
 * Kept on this phone only, flagged with the refusal's reason — not queued:
 * the same text sent again would most likely be refused again. Editing it
 * sends it, as a new note. (A note the server never confirmed is not copied:
 * it is the phone's own, and it stays as it is, flagged.)
 */
export function refusedTextCopy(
  result: SyncResult,
  sent: Pick<PendingMutation, "op" | "fields">,
  local: LocalIssue | null,
  id: string,
  now: string
): LocalIssue | null {
  if (result.status !== "rejected" || sent.op !== "upsert") return null;
  const text = sent.fields.description;
  if (typeof text !== "string" || isBlankHtml(text)) return null;
  if (!local || !local.server_updated_at) return null;
  const row = (result.row ?? null) as SyncIssueRow | null;
  if (row && row.description === text) return null;

  const mark = " (not synced)";
  const title = `${effectiveTitle(local.title, text).slice(0, ISSUE_TITLE_MAX - mark.length).trimEnd()}${mark}`;
  return {
    id,
    title,
    client_id: local.client_id,
    category: local.category,
    note_format: "text",
    status: local.status,
    progress: local.progress,
    due_date: local.due_date,
    description: text,
    sort_order: local.sort_order,
    created_at: now,
    updated_at: now,
    server_updated_at: null,
    announced: 1,
    deleted_at: null,
    sync_error: result.reason ?? "rejected",
    search: searchText(title, text),
  };
}

/**
 * The same, for an idea: words of an idea the server refused, when the
 * server's row (or none) is about to take its place without them. They are
 * kept as a note on this phone, named after the canvas, flagged and not
 * queued — like `refusedTextCopy`. Null when nothing would be lost.
 */
export function refusedIdeaCopy(
  result: SyncResult,
  sent: Pick<PendingMutation, "op" | "fields">,
  canvasTitle: string | null,
  id: string,
  now: string
): LocalIssue | null {
  if (result.status !== "rejected" || sent.op !== "upsert") return null;
  const text = sent.fields.content;
  if (typeof text !== "string" || isBlankHtml(text)) return null;
  const row = (result.row ?? null) as SyncNodeRow | null;
  if (row && row.content === text) return null;

  const mark = " · idea (not synced)";
  const base = (canvasTitle ?? "").trim() || "Canvas";
  const title = `${base.slice(0, ISSUE_TITLE_MAX - mark.length).trimEnd()}${mark}`;
  return {
    id,
    title,
    client_id: null,
    category: "note",
    note_format: "text",
    status: "pending",
    progress: 0,
    due_date: null,
    description: text,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    server_updated_at: null,
    announced: 1,
    deleted_at: null,
    sync_error: result.reason ?? "rejected",
    search: searchText(title, text),
  };
}
