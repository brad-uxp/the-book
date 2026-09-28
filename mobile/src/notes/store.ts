import type { SQLiteDatabase } from "expo-sqlite";
import { write, type Table } from "@/db/database";
import * as repo from "@/db/repo";
import { newId, textHash } from "@/lib/hash";
import { TEXT_TOO_LONG, type LocalIssue } from "@/sync/merge";
import { changedFields, coalesce, hasPendingDelete } from "@/sync/outbox";
import { SEED_NODE_HEIGHT, SEED_NODE_WIDTH } from "@shared/note-canvas";
import { effectiveTitle, isBlankHtml, isBlankNote, searchText, textTooLong } from "./text";

/**
 * Everything the phone does to a note, offline first: the local row changes
 * at once (the screens read only SQLite) and a change is queued for the
 * server. The sync engine pushes the queue; see src/sync/engine.ts.
 */

/** What the screens may change. Turning a note into a canvas is `convertToCanvas`. */
export type IssueEdit = Partial<
  Pick<LocalIssue, "title" | "client_id" | "category" | "status" | "progress" | "due_date" | "description">
>;

/** How long a deleted note waits for Undo before its deletion is queued. */
export const UNDO_MS = 6000;

const TABLES: Table[] = ["issues", "outbox"];

let localWriteListener: () => void = () => undefined;

/** The sync engine listens here to push soon after the person stops typing. */
export function setLocalWriteListener(listener: () => void): void {
  localWriteListener = listener;
}

/** Tells the sync engine something was queued — for writes made outside this module (the canvas). */
export function notifyLocalWrite(): void {
  localWriteListener();
}

/** Every field, as a create needs them — for a note the server has never seen. */
function allFields(row: LocalIssue): Record<string, unknown> {
  return {
    title: effectiveTitle(row.title, row.description),
    client_id: row.client_id,
    category: row.category,
    note_format: row.note_format,
    status: row.status,
    progress: row.progress,
    due_date: row.due_date,
    description: row.description,
    sort_order: row.sort_order,
  };
}

function titleHint(row: LocalIssue): string {
  return effectiveTitle(row.title, row.description);
}

/**
 * A new, empty note, task or canvas, on the phone only. Nothing is queued
 * until something is written in it (for a canvas: a title or an idea) — an
 * empty one is discarded on leaving.
 */
export async function createNote(kind: "note" | "task" | "canvas"): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await write(TABLES, (db) =>
    repo.putIssue(db, {
      id,
      title: "",
      client_id: null,
      category: kind === "task" ? "task" : "note",
      note_format: kind === "canvas" ? "canvas" : "text",
      status: "pending",
      progress: 0,
      due_date: null,
      description: "",
      sort_order: 0,
      created_at: now,
      updated_at: now,
      server_updated_at: null,
      announced: 0,
      deleted_at: null,
      sync_error: null,
      search: "",
    })
  );
  return id;
}

/**
 * Changes a note. `previousDescription` is the text the editor had before
 * this change: the server compares the hash of it with its own text to tell
 * whether someone else changed the note meanwhile (a conflict), so it has to
 * be what this edit really started from — not whatever the row holds by now.
 */
export async function editIssue(
  id: string,
  edit: IssueEdit,
  opts: { previousDescription?: string } = {}
): Promise<void> {
  const changed = await write(TABLES, async (db) => {
    const row = await repo.getIssue(db, id);
    if (!row) return false;
    const diff = changedFields(row, edit);
    if (Object.keys(diff).length === 0) return false;

    const next: LocalIssue = { ...row, ...diff, updated_at: new Date().toISOString() };
    next.search = searchText(next.title, next.description);

    // A text past the server's limit stays here, flagged, and is not queued:
    // the server would refuse it. Once shortened it goes out like any edit —
    // judged against the text the edit started from, so if the server's text
    // is not that one, the server keeps its own and the phone's becomes a
    // "(conflict)" copy: words are never lost either way.
    const tooLong = textTooLong(next.description);
    if (tooLong) next.sync_error = TEXT_TOO_LONG;
    else if (row.sync_error === TEXT_TOO_LONG) next.sync_error = null;

    if (!row.announced) {
      // A new note becomes real with its first words; until then it stays
      // here. One too long to send shows in the list all the same; its create
      // goes out with the first edit that brings it under the limit.
      if (!isBlankNote(next.title, next.description)) {
        next.announced = 1;
        if (!tooLong) await repo.enqueue(db, create(next));
      }
      await repo.putIssue(db, next);
      return true;
    }

    await repo.putIssue(db, next);
    if (tooLong) {
      // A note the server has never confirmed is held back whole: its create
      // must carry its text. One it has keeps sending everything but the text.
      if (!row.server_updated_at) return true;
      const { description: _held, ...rest } = diff;
      if (Object.keys(rest).length === 0) return true;
      await queueEdit(db, row, next, rest, opts.previousDescription);
      return true;
    }
    await queueEdit(db, row, next, diff, opts.previousDescription);
    return true;
  });
  if (changed) localWriteListener();
}

/**
 * Makes a new note real for the server: queues its create. A canvas needs it
 * before its first idea, which the server only accepts on a canvas it has.
 * Nothing when it already is.
 */
export async function announceIssue(db: SQLiteDatabase, id: string): Promise<void> {
  const row = await repo.getIssue(db, id);
  if (!row || row.announced) return;
  const next: LocalIssue = { ...row, announced: 1 };
  await repo.putIssue(db, next);
  await repo.enqueue(db, create(next));
}

/**
 * Turns a text note into a canvas, as on the web: what it said becomes the
 * canvas's first idea, and there is no way back (lib/notes.ts).
 *
 * The phone makes that first idea itself — so the canvas shows it at once,
 * offline too — and tells the server the note's text is now empty: the
 * server then seeds nothing of its own (lib/sync.ts planIssueUpsert). The
 * conversion is judged against the text the note had, so if the server's
 * changed meanwhile it keeps that too, as another idea.
 */
export async function convertToCanvas(id: string): Promise<void> {
  const changed = await write(["issues", "canvas_nodes", "outbox"], async (db) => {
    const row = await repo.getIssue(db, id);
    if (!row || row.category !== "note" || row.note_format === "canvas") return false;
    const now = new Date().toISOString();
    const text = row.description;
    const next: LocalIssue = { ...row, note_format: "canvas", description: "", updated_at: now };
    next.search = searchText(next.title, "");
    // A text too long to sync is not one the server ever had.
    if (next.sync_error === TEXT_TOO_LONG) next.sync_error = null;

    if (!row.announced) {
      await repo.putIssue(db, next);
    } else {
      await repo.putIssue(db, next);
      if (!row.server_updated_at && row.sync_error === TEXT_TOO_LONG) {
        // Never sent (its text was too long): the create goes out now, as a canvas.
        await repo.enqueue(db, create(next));
      } else {
        await queueEdit(db, row, next, { note_format: "canvas", description: "" }, row.description);
      }
    }

    if (!isBlankHtml(text)) {
      // The first idea needs the canvas on the server first.
      if (!next.announced) await announceIssue(db, id);
      const node = {
        id: newId(),
        issue_id: id,
        content: text,
        color: null,
        x: 0,
        y: 0,
        width: SEED_NODE_WIDTH,
        height: SEED_NODE_HEIGHT,
        created_at: now,
        updated_at: now,
        server_updated_at: null,
      };
      await repo.putLocalNode(db, node);
      await repo.enqueue(db, {
        mutation_id: newId(),
        entity: "canvas_node",
        op: "upsert",
        entity_id: node.id,
        fields: { issue_id: id, content: text, color: null, x: 0, y: 0, width: SEED_NODE_WIDTH, height: SEED_NODE_HEIGHT },
        base_updated_at: null,
        base_hash: null,
        title_hint: null,
      });
    }
    return true;
  });
  if (changed) localWriteListener();
}

function create(row: LocalIssue) {
  return {
    mutation_id: newId(),
    entity: "issue" as const,
    op: "upsert" as const,
    entity_id: row.id,
    fields: allFields(row),
    base_updated_at: null,
    base_hash: null,
    title_hint: titleHint(row),
  };
}

async function queueEdit(
  db: SQLiteDatabase,
  row: LocalIssue,
  next: LocalIssue,
  diff: IssueEdit & Partial<Pick<LocalIssue, "note_format">>,
  previousDescription: string | undefined
): Promise<void> {
  const queue = await repo.queueFor(db, "issue", row.id);
  const last = queue[queue.length - 1] ?? null;

  // Until the server has confirmed the note, every change carries all of it:
  // if the create never made it, this change is the create.
  const fields: Record<string, unknown> = row.server_updated_at ? { ...diff } : allFields(next);
  if ("title" in fields) fields.title = effectiveTitle(next.title, next.description);

  let baseHash: string | null = null;
  if ("description" in diff) {
    const folds = last?.op === "upsert" && last.attempts === 0 && "description" in last.fields;
    if (!folds) baseHash = await textHash(previousDescription ?? row.description);
  }

  const change = { fields, base_updated_at: row.server_updated_at, base_hash: baseHash, title_hint: titleHint(next) };
  const merged = coalesce(last, change);
  if (merged.action === "merge" && last) {
    await repo.rewritePending(db, last.seq, merged);
  } else {
    await repo.enqueue(db, { mutation_id: newId(), entity: "issue", op: "upsert", entity_id: row.id, ...change });
  }
}

/** Hides a note at once; its deletion is queued once the Undo window has passed. */
export async function deleteIssue(id: string): Promise<void> {
  await write(TABLES, (db) => db.runAsync("UPDATE issues SET deleted_at = ? WHERE id = ?", Date.now(), id));
  setTimeout(() => {
    finalizeDeletes().catch((err) => console.warn("[notes] finalize", err));
  }, UNDO_MS + 500);
}

/** Brings a deleted note back. False when there is nothing to undo. */
export async function undoDelete(id: string): Promise<boolean> {
  const undone = await write(TABLES, async (db) => {
    const row = await repo.getIssue(db, id);
    if (!row || row.deleted_at === null) return false;
    const queue = await repo.queueFor(db, "issue", id);
    const del = queue.find((m) => m.op === "delete");
    if (del && del.attempts === 0) {
      await repo.dropPending(db, del.mutation_id);
    } else if (del) {
      // Already on its way: put it back on the server as it was.
      await repo.enqueue(db, create({ ...row, deleted_at: null }));
    }
    await repo.putIssue(db, { ...row, deleted_at: null });
    return true;
  });
  if (undone) localWriteListener();
  return undone;
}

/**
 * Queues the deletion of notes whose Undo has run out. Also runs when the
 * engine starts, for a deletion the app was closed in the middle of.
 */
export async function finalizeDeletes(now: number = Date.now()): Promise<void> {
  const queued = await write(TABLES, async (db) => {
    const rows = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM issues WHERE deleted_at IS NOT NULL AND deleted_at <= ?",
      now - UNDO_MS
    );
    let any = false;
    for (const { id } of rows) {
      const row = await repo.getIssue(db, id);
      if (!row) continue;
      const queue = await repo.queueFor(db, "issue", id);
      if (hasPendingDelete(queue)) continue;

      if (!row.server_updated_at && queue.every((m) => m.attempts === 0)) {
        // The server never saw it: forget it here and that is all.
        for (const m of queue) await repo.dropPending(db, m.mutation_id);
        await repo.removeIssue(db, id);
        continue;
      }
      await repo.enqueue(db, {
        mutation_id: newId(),
        entity: "issue",
        op: "delete",
        entity_id: id,
        fields: {},
        base_updated_at: row.server_updated_at,
        // The text the person saw when deleting: the server refuses to delete
        // words that changed since, instead of losing them unseen.
        base_hash: await textHash(row.description),
        title_hint: titleHint(row),
      });
      any = true;
    }
    return any;
  });
  if (queued) localWriteListener();
}

/** Nothing typed anywhere — and, for a canvas, not a single idea on it. */
async function isBlankIssue(db: SQLiteDatabase, row: LocalIssue): Promise<boolean> {
  if (!isBlankNote(row.title, row.description)) return false;
  if (row.note_format !== "canvas") return true;
  return !(await db.getFirstAsync("SELECT 1 FROM canvas_nodes WHERE issue_id = ?", row.id));
}

/**
 * Leaving a new note with nothing in it throws it away. True when it did.
 */
export async function discardIfBlank(id: string): Promise<boolean> {
  const discarded = await write(TABLES, async (db) => {
    const row = await repo.getIssue(db, id);
    if (!row || !(await isBlankIssue(db, row))) return false;
    if (!row.announced) {
      await repo.removeIssue(db, id);
      return true;
    }
    // Written, synced, then emptied: a deletion like any other, without the wait.
    await db.runAsync("UPDATE issues SET deleted_at = ? WHERE id = ?", Date.now() - UNDO_MS, id);
    return true;
  });
  if (discarded) await finalizeDeletes();
  return discarded;
}

/** New notes left empty when the app was closed on them. */
export async function dropBlankDrafts(): Promise<void> {
  await write(TABLES, async (db) => {
    const drafts = await db.getAllAsync<{ id: string }>("SELECT id FROM issues WHERE announced = 0");
    for (const d of drafts) {
      const row = await repo.getIssue(db, d.id);
      if (row && (await isBlankIssue(db, row))) await repo.removeIssue(db, d.id);
    }
  });
}
