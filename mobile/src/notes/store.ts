import type { SQLiteDatabase } from "expo-sqlite";
import { write, type Table } from "@/db/database";
import * as repo from "@/db/repo";
import { newId, textHash } from "@/lib/hash";
import type { LocalIssue } from "@/sync/merge";
import { changedFields, coalesce, hasPendingDelete } from "@/sync/outbox";
import { effectiveTitle, isBlankNote, searchText } from "./text";

/**
 * Everything the phone does to a note, offline first: the local row changes
 * at once (the screens read only SQLite) and a change is queued for the
 * server. The sync engine pushes the queue; see src/sync/engine.ts.
 */

/** What the screens may change. What a note is made of (text ↔ canvas) is the web's, for now. */
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
 * A new, empty note or task, on the phone only. Nothing is queued until
 * something is written in it — an empty one is discarded on leaving.
 */
export async function createNote(kind: "note" | "task"): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await write(TABLES, (db) =>
    repo.putIssue(db, {
      id,
      title: "",
      client_id: null,
      category: kind,
      note_format: "text",
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

    if (!row.announced) {
      // A new note becomes real with its first words; until then it stays here.
      if (!isBlankNote(next.title, next.description)) {
        next.announced = 1;
        await repo.enqueue(db, create(next));
      }
      await repo.putIssue(db, next);
      return true;
    }

    await repo.putIssue(db, next);
    await queueEdit(db, row, next, diff, opts.previousDescription);
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
  diff: IssueEdit,
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

/**
 * Leaving a new note with nothing in it throws it away. True when it did.
 */
export async function discardIfBlank(id: string): Promise<boolean> {
  const discarded = await write(TABLES, async (db) => {
    const row = await repo.getIssue(db, id);
    if (!row || !isBlankNote(row.title, row.description)) return false;
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
    const drafts = await db.getAllAsync<{ id: string; title: string; description: string }>(
      "SELECT id, title, description FROM issues WHERE announced = 0"
    );
    for (const d of drafts) {
      if (isBlankNote(d.title, d.description)) await repo.removeIssue(db, d.id);
    }
  });
}
