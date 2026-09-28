/**
 * The rules of the phone's note sync, pure: how far back a pull reads, when a
 * cursor is too old, and what a pushed change does to the row the server has.
 *
 * The database side is lib/sync-server.ts; the wire format is
 * lib/sync-protocol.ts. One user, a few hundred notes: last write wins per
 * field, and the only merge is for text — a note's description or an idea's
 * content — where losing either side would lose words. There, the server
 * keeps its text and the phone's becomes a copy.
 */

import { createHash } from "node:crypto";
import { checkShapeChange, isBlankHtml, type IssueShape } from "./notes";
import { ISSUE_TITLE_MAX } from "./text-limits";
import type { SyncMutation } from "./sync-protocol";

// ─── Retention ───────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a deletion is remembered. A phone away for longer starts over. */
export const SYNC_TOMBSTONE_RETENTION_MS = 60 * DAY_MS;

/** How long the answer to a pushed change is kept for a retry to find. */
export const SYNC_MUTATION_RETENTION_MS = 30 * DAY_MS;

/** What the daily job deletes: everything older than these. */
export function syncPurgeCutoffs(now: Date): { tombstonesBefore: Date; mutationsBefore: Date } {
  return {
    tombstonesBefore: new Date(now.getTime() - SYNC_TOMBSTONE_RETENTION_MS),
    mutationsBefore: new Date(now.getTime() - SYNC_MUTATION_RETENTION_MS),
  };
}

// ─── Pull ────────────────────────────────────────────────────────────────────

/**
 * How far before the cursor each pull reads again.
 *
 * A row's timestamp is taken when it is written, but it only becomes visible
 * when its transaction commits — and tombstones are dated by the database's
 * clock, rows by the app's. A pull that ran between the two would step past
 * the row for good. Re-reading a window behind the cursor catches it; the cost
 * is re-sending the few rows touched in that window, which the phone applies
 * by id, idempotently.
 */
export const SYNC_OVERLAP_MS = 2 * 60 * 1000;

/** Rows per entity per page. Descriptions can be long, hence the smaller one. */
export const SYNC_PAGE_LIMITS = {
  issues: 200,
  canvas_nodes: 500,
  canvas_edges: 1000,
  tombstones: 1000,
} as const;

export type PullEntity = keyof typeof SYNC_PAGE_LIMITS;

/**
 * The most a pull page carries, in bytes of JSON. A page of full rows can be
 * big — 200 notes and 500 ideas of up to 200 000 characters each is well over
 * a hundred megabytes — so a page also ends once its rows reach this, with
 * `has_more`. The same size as a push's answer budget.
 */
export const SYNC_PULL_BUDGET_BYTES = 4 * 1024 * 1024;

/**
 * Decides, row by row in page order, which rows fit in a page of `maxBytes`.
 *
 * The first row always fits, however big — a page must make progress. Once a
 * row does not fit, the page is full: nothing after it is taken, not even a
 * row small enough, so every list ends at its last row taken and the cursor
 * resumes each from there. `null` is a row read but not sent (a tombstone of
 * a row that exists again): it costs nothing, and is passed only while the
 * page has room.
 */
export function createPageBudget(maxBytes: number) {
  let used = 0;
  let taken = 0;
  let full = false;
  return {
    fits(row: unknown): boolean {
      if (full) return false;
      if (row === null) return true;
      const size = Buffer.byteLength(JSON.stringify(row), "utf8") + 1;
      if (taken > 0 && used + size > maxBytes) {
        full = true;
        return false;
      }
      used += size;
      taken += 1;
      return true;
    },
    get full(): boolean {
      return full;
    },
  };
}

/** Keyset position in one entity's (timestamp, id) order. Tombstone ids are bigints, as strings. */
export type Position = [number, string];
export type Positions = Partial<Record<PullEntity, Position>>;

/**
 * What a cursor carries. Opaque to the phone.
 *
 *  - `t`: the lower bound of the pull round (ms), or null for everything.
 *  - `at`, `k`: only in the middle of a paged round — when that round started,
 *    and how far each entity has been read. A finished round's cursor is just
 *    `{ t: at }`: everything up to when it started has been seen.
 */
interface CursorData {
  v: 1;
  t: number | null;
  at?: number;
  k?: Positions;
}

export function encodeCursor(data: Omit<CursorData, "v">): string {
  return Buffer.from(JSON.stringify({ v: 1, ...data })).toString("base64url");
}

function isPosition(p: unknown): p is Position {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    Number.isFinite(p[0]) &&
    typeof p[1] === "string" &&
    p[1].length > 0 &&
    p[1].length <= 64
  );
}

export function decodeCursor(raw: string): CursorData | null {
  if (raw.length > 2000) return null;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1) return null;
  if (d.t !== null && !Number.isFinite(d.t)) return null;
  if (d.at !== undefined && !Number.isFinite(d.at)) return null;
  const k: Positions = {};
  if (d.k !== undefined) {
    if (!d.k || typeof d.k !== "object") return null;
    for (const [name, pos] of Object.entries(d.k as Record<string, unknown>)) {
      if (!(name in SYNC_PAGE_LIMITS) || !isPosition(pos)) return null;
      k[name as PullEntity] = pos;
    }
  }
  return {
    v: 1,
    t: d.t as number | null,
    ...(d.at !== undefined ? { at: d.at as number } : {}),
    ...(d.k !== undefined ? { k } : {}),
  };
}

export interface PullPlan {
  /** The round's lower bound (the cursor minus the overlap), or null for everything. */
  from: Date | null;
  /** The round's lower bound as the cursor states it — carried to the next page. */
  since: number | null;
  /** When the round started: the cursor once it is done. */
  at: number;
  after: Positions;
  /** The cursor was too old or not understood; this is a full sync. */
  reset: boolean;
}

/**
 * How far ahead of the server's clock a cursor's time may be. Every time in a
 * cursor was read from this server or its database, so only their clocks'
 * drift can put one in the future.
 */
const CURSOR_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The largest id a tombstone can have: Postgres's bigint. */
const BIGINT_MAX = BigInt("9223372036854775807");

/** A tombstone's id as a cursor carries it: a decimal Postgres bigint, no sign, no leading zeros. */
export function isTombstoneId(id: string): boolean {
  return /^(0|[1-9]\d{0,18})$/.test(id) && BigInt(id) <= BIGINT_MAX;
}

/**
 * Whether every value a cursor carries is one this server could have issued:
 * times a whole number of ms, from 1970 up to (about) now; a tombstone
 * position a bigint id. Anything else was not made here — and a time Date
 * cannot hold, or an id past bigint, would reach the database as a value it
 * refuses and fail the whole pull.
 */
function cursorValuesValid(cursor: CursorData, now: number): boolean {
  const ok = (ms: number) => Number.isSafeInteger(ms) && ms >= 0 && ms <= now + CURSOR_CLOCK_SKEW_MS;
  if (cursor.t !== null && !ok(cursor.t)) return false;
  if (cursor.at !== undefined && !ok(cursor.at)) return false;
  const tomb = cursor.k?.tombstones;
  if (tomb && !isTombstoneId(tomb[1])) return false;
  return Object.values(cursor.k ?? {}).every((pos) => ok(pos[0]));
}

/**
 * Where a pull reads from. `now` must be taken before any query runs, so that
 * nothing written during the pull is dated before the cursor it hands back.
 */
export function planPull(raw: string | null, now: number): PullPlan {
  const full = (reset: boolean): PullPlan => ({ from: null, since: null, at: now, after: {}, reset });
  if (raw === null || raw === "") return full(false);

  const cursor = decodeCursor(raw);
  if (!cursor || !cursorValuesValid(cursor, now)) return full(true);

  if (cursor.t !== null && cursor.t - SYNC_OVERLAP_MS < now - SYNC_TOMBSTONE_RETENTION_MS) {
    // Deletions older than this may already be purged; the phone could keep
    // rows that are gone. Only a full sync is safe.
    return full(true);
  }

  const from = cursor.t === null ? null : new Date(cursor.t - SYNC_OVERLAP_MS);
  if (cursor.at !== undefined) {
    return { from, since: cursor.t, at: cursor.at, after: cursor.k ?? {}, reset: false };
  }
  return { from, since: cursor.t, at: now, after: {}, reset: false };
}

/** The cursor to hand back after a page. */
export function nextCursor(plan: PullPlan, positions: Positions, hasMore: boolean): string {
  return hasMore
    ? encodeCursor({ t: plan.since, at: plan.at, k: positions })
    : encodeCursor({ t: plan.at });
}

// ─── Push ────────────────────────────────────────────────────────────────────

/**
 * When a push stops early and answers what it has done so far (`more`): the
 * phone sends the rest at once. Each change is answered with its row, and a
 * row can hold a long note, so the answer is cut near a few megabytes rather
 * than grown to hundreds; the time limit keeps one push from holding a
 * database connection for long.
 */
export const SYNC_PUSH_BUDGET = { bytes: 4 * 1024 * 1024, ms: 10_000 } as const;

/**
 * How many changes one caller may push per minute. A push costs one unit per
 * change it carries — each is a transaction of several queries, so a request
 * count would let one 200-change push weigh the same as a one-change one.
 * A phone catching up after days offline sends a few hundred at most; past
 * the budget it gets a 429 with Retry-After and sends the rest then.
 */
export const SYNC_MUTATIONS_PER_MINUTE = 1000;

/** sha256 of a text, hex — what `base_hash` is compared against. UTF-8, like the phone's. */
export function textHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** JSON with object keys sorted, at every depth: one string per value, whatever the key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * What a pushed change carries, as a hash: every field of the change as
 * validated (SyncMutationSchema) but its id. Validation drops unknown keys
 * and keeps `fields` flat, so this hashes a bounded, shallow value — never
 * whatever else a client sent. A retry of the same change hashes the same
 * (the phone never alters a change once sent), so a different hash under a
 * known id is a reused id, not a retry.
 */
export function mutationPayloadHash(m: SyncMutation): string {
  const { mutation_id: _id, ...payload } = m;
  return textHash(canonicalJson(payload));
}

/**
 * The title of a note holding the phone's side of a conflict. The mark goes at
 * the end so the list still sorts and reads by the original title; a title
 * already at the limit is cut to make room for it, so the copy is a note the
 * phone can edit and send back.
 */
export function conflictTitle(title: string | null | undefined, fallback = "Recovered note"): string {
  const mark = " (conflict)";
  const base = ((title ?? "").trim() || fallback).slice(0, ISSUE_TITLE_MAX - mark.length).trimEnd();
  return `${base}${mark}`;
}

/** An issue's fields a push may set. Only the keys present were changed. */
export interface IssuePatch {
  title?: string;
  client_id?: string | null;
  category?: "task" | "note";
  note_format?: "text" | "canvas";
  status?: "pending" | "in_progress" | "blocked" | "done";
  progress?: number;
  due_date?: string | null;
  description?: string;
  sort_order?: number;
}

export interface IssueNow extends IssueShape {
  title: string;
  description: string;
  client_id: string | null;
}

export interface Change<P> {
  base_updated_at?: string | null;
  base_hash?: string | null;
  fields: P;
}

export type IssuePlan =
  /** No such row, and the phone made it: create it with the phone's id. */
  | { action: "create"; data: IssuePatch }
  /** Apply `data`. With `conflictText`, the phone's text goes to a copy instead. */
  | { action: "update"; data: IssuePatch; conflictText?: string }
  /** The row was deleted on the server while the phone edited its text: keep the text as a note. */
  | { action: "recover"; text: string }
  /** The row was deleted on the server and the edit carried no text. */
  | { action: "gone" }
  | { action: "reject"; reason: string };

/**
 * What an issue upsert does, given the row as the server has it now (null if
 * there is none).
 *
 * Changing what a note is made of (text ↔ canvas) is refused from the phone
 * for now: turning a note into a canvas moves its text into the first idea,
 * and the phone has no canvas to show it in until the canvas arrives there.
 */
export function planIssueUpsert(current: IssueNow | null, change: Change<IssuePatch>): IssuePlan {
  const f = change.fields;
  const formatNow = current?.note_format ?? "text";
  if (f.note_format !== undefined && f.note_format !== formatNow) {
    return { action: "reject", reason: "note_format_unsupported" };
  }

  if (!current) {
    if (change.base_updated_at) {
      // The phone had this row from the server: it has since been deleted.
      return f.description !== undefined && !isBlankHtml(f.description)
        ? { action: "recover", text: f.description }
        : { action: "gone" };
    }
    if (!f.title?.trim()) return { action: "reject", reason: "invalid" };
    const shape = checkShapeChange(null, {
      category: f.category ?? "task",
      note_format: f.note_format ?? "text",
    });
    if (!shape.ok) return { action: "reject", reason: "shape" };
    return { action: "create", data: f };
  }

  const shape = checkShapeChange(current, {
    category: f.category ?? current.category,
    note_format: f.note_format ?? current.note_format,
  });
  if (!shape.ok) return { action: "reject", reason: "shape" };

  if (
    f.description !== undefined &&
    textChangedElsewhere(current.description, f.description, change.base_hash)
  ) {
    const { description, ...rest } = f;
    return { action: "update", data: rest, conflictText: description };
  }
  return { action: "update", data: f };
}

/**
 * True when the server's text is no longer the one the phone's edit started
 * from, and the two differ — so writing the phone's would lose the server's.
 * Without a base hash (a row the phone created) the phone's text simply wins.
 */
export function textChangedElsewhere(
  serverText: string,
  phoneText: string,
  baseHash: string | null | undefined
): boolean {
  if (!baseHash) return false;
  if (serverText === phoneText) return false;
  return textHash(serverText) !== baseHash;
}

/** An idea's fields a push may set. `issue_id` only when creating it. */
export interface NodePatch {
  issue_id?: string;
  content?: string;
  color?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface NodeNow {
  issue_id: string;
  content: string;
  color: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a conflicting idea's copy sits from the original, down and right. */
export const CONFLICT_NODE_OFFSET = 24;

export type NodePlan =
  | { action: "create"; data: NodePatch & { issue_id: string; x: number; y: number } }
  | { action: "update"; data: NodePatch; conflictCopy?: NodePatch & { issue_id: string; x: number; y: number; content: string } }
  | { action: "recover"; text: string }
  | { action: "gone" }
  | { action: "reject"; reason: string };

/**
 * What an idea upsert does. `canvas` is the note the idea belongs to (or would
 * belong to): null when that note no longer exists, `isCanvas: false` when it
 * exists but is not a canvas.
 */
export function planNodeUpsert(
  current: NodeNow | null,
  change: Change<NodePatch>,
  canvas: { isCanvas: boolean } | null
): NodePlan {
  const f = change.fields;
  const carriesText = f.content !== undefined && !isBlankHtml(f.content);

  if (!current) {
    if (change.base_updated_at || !canvas) {
      // Deleted on the server — the idea, or the whole canvas under it.
      return carriesText ? { action: "recover", text: f.content! } : { action: "gone" };
    }
    if (!canvas.isCanvas) return { action: "reject", reason: "not_a_canvas" };
    if (!f.issue_id || f.x === undefined || f.y === undefined) {
      return { action: "reject", reason: "invalid" };
    }
    return { action: "create", data: { ...f, issue_id: f.issue_id, x: f.x, y: f.y } };
  }

  if (f.issue_id !== undefined && f.issue_id !== current.issue_id) {
    return { action: "reject", reason: "invalid" };
  }
  const { issue_id: _ignored, ...data } = f;

  if (f.content !== undefined && textChangedElsewhere(current.content, f.content, change.base_hash)) {
    const { content, ...rest } = data;
    const x = rest.x ?? current.x;
    const y = rest.y ?? current.y;
    return {
      action: "update",
      data: rest,
      conflictCopy: {
        issue_id: current.issue_id,
        content: content!,
        color: rest.color !== undefined ? rest.color : current.color,
        width: rest.width ?? current.width,
        x: x + CONFLICT_NODE_OFFSET,
        y: y + CONFLICT_NODE_OFFSET,
      },
    };
  }
  return { action: "update", data };
}

export type DeletePlan =
  | { action: "delete" }
  /** Nothing to delete: the row is already gone. That is success. */
  | { action: "noop" }
  /** The text changed on the server since the phone last saw it: deleting would lose words the phone never showed. */
  | { action: "reject"; reason: "changed_on_server" };

export function planDelete(
  currentText: string | null,
  baseHash: string | null | undefined
): DeletePlan {
  if (currentText === null) return { action: "noop" };
  if (baseHash && !isBlankHtml(currentText) && textHash(currentText) !== baseHash) {
    return { action: "reject", reason: "changed_on_server" };
  }
  return { action: "delete" };
}
