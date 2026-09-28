/**
 * The wire format of the phone's note sync — GET/POST /api/sync/notes and
 * GET /api/sync/refs.
 *
 * No imports, on purpose: the mobile app reads these types through
 * `@shared/sync-protocol`, so both ends are checked against one definition.
 * The rules live in lib/sync.ts; the database side in lib/sync-server.ts.
 */

import type { Side } from "./canvas-geometry";

export type SyncEntity = "issue" | "canvas_node" | "canvas_edge";

/** How many changes one push may carry, and how big its body may be. */
export const SYNC_PUSH_MAX = 200;
export const SYNC_PUSH_MAX_BYTES = 5 * 1024 * 1024;

/** An issue as the phone stores it. Dates are ISO strings. */
export interface SyncIssueRow {
  id: string;
  title: string;
  client_id: string | null;
  category: "task" | "note";
  note_format: "text" | "canvas";
  status: "pending" | "in_progress" | "blocked" | "done";
  progress: number;
  due_date: string | null;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SyncNodeRow {
  id: string;
  issue_id: string;
  content: string;
  color: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
}

/**
 * A connection. Its ends and its pinned sides can change after it is made
 * (from the web, for now), so it is pulled by updated_at like the rest.
 */
export interface SyncEdgeRow {
  id: string;
  issue_id: string;
  source_id: string;
  target_id: string;
  /** The side of each card it is pinned to; null lets the canvas choose. */
  source_side: Side | null;
  target_side: Side | null;
  created_at: string;
  updated_at: string;
}

export interface SyncTombstoneRow {
  entity: SyncEntity;
  entity_id: string;
  issue_id: string | null;
  deleted_at: string;
}

/**
 * One page of "what changed since". Keep calling with `cursor` while
 * `has_more`; store the cursor after applying each page, so an interrupted
 * pull resumes where it stopped. A page holds up to a few hundred rows per
 * list and about 4 MB in all; any list may be cut short, or empty, while
 * `has_more` is true.
 *
 * `reset` means the cursor sent was too old (deletions from before it may
 * already be forgotten) or not understood: this page starts a FULL sync, and
 * the phone must drop every row it holds that has no unsent change, then
 * apply the pages as they come.
 */
export interface SyncPullResponse {
  cursor: string;
  reset: boolean;
  has_more: boolean;
  issues: SyncIssueRow[];
  canvas_nodes: SyncNodeRow[];
  canvas_edges: SyncEdgeRow[];
  tombstones: SyncTombstoneRow[];
}

/**
 * One change the phone made. `fields` holds ONLY what changed.
 *
 *  - `base_updated_at`: the server's `updated_at` of the row the change was
 *    made on; absent for a row the phone created. It is how the server tells
 *    "edit a row that is gone" from "create this row".
 *  - `base_hash`: sha256 (hex) of the text — an issue's description, an
 *    idea's content — that the edit started from. Sent with any change of
 *    that text, and with a delete. A server text that no longer hashes the
 *    same was changed elsewhere meanwhile.
 *  - `title_hint`: the issue's title as the phone knows it, only to name a
 *    conflict copy if the issue turns out to be deleted on the server.
 */
export interface SyncMutation {
  mutation_id: string;
  entity: SyncEntity;
  op: "upsert" | "delete";
  id: string;
  base_updated_at?: string | null;
  base_hash?: string | null;
  title_hint?: string;
  fields?: Record<string, unknown>;
}

/**
 *  - applied: done as sent (a delete of a row already gone is applied too).
 *  - conflict_copy: the text had changed on the server; the server kept its
 *    text and saved the phone's as a copy (`conflict_copy_id`) — a new note,
 *    or for an idea a sibling idea. Any other field in the change was applied.
 *    Also the answer to an edit of a deleted row that carried text.
 *  - deleted: the row is gone on the server and the change carried no text
 *    worth keeping. Drop the row.
 *  - rejected: not applied (`reason`). `row` is the server's row when one
 *    exists — the phone replaces its version with it.
 */
export type SyncResultStatus = "applied" | "conflict_copy" | "deleted" | "rejected";

export type SyncRow = SyncIssueRow | SyncNodeRow | SyncEdgeRow;

export interface SyncResult {
  mutation_id: string;
  status: SyncResultStatus;
  reason?: string;
  /** The row as the server now has it, when it exists. */
  row?: SyncRow | null;
  conflict_copy_id?: string;
}

/**
 * Results in the order the mutations were sent. Mutations without a result
 * were not processed and must be sent again, in order:
 *
 *  - with `more`, the server stopped on purpose — the answer grew too big or
 *    the push took too long. Send the rest right away.
 *  - without it, it stopped on a failure (the database was unreachable).
 *    Retry later.
 */
export interface SyncPushResponse {
  results: SyncResult[];
  more?: boolean;
}

/** What the phone needs offline to label clients and offer @ and # mentions. */
export interface SyncRefs {
  clients: { id: string; name: string; color_hex: string }[];
  people: { id: string; name: string; role: string | null; status: "active" | "inactive" }[];
  invoices: {
    id: string;
    invoice_number: string | null;
    client_name: string;
    status: "pending" | "accounting" | "sent" | "paid";
    /** The invoice's total — what its mention label shows. */
    amount_cents: number;
  }[];
}
