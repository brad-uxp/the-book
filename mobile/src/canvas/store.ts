import type { SQLiteDatabase } from "expo-sqlite";
import type { Side } from "@shared/canvas-geometry";
import { NODE_DEFAULT_HEIGHT, NODE_DEFAULT_WIDTH } from "@shared/note-canvas";
import type { SyncEdgeRow } from "@shared/sync-protocol";
import { write, type Table } from "@/db/database";
import * as repo from "@/db/repo";
import type { LocalNode } from "@/db/repo";
import { newId, textHash } from "@/lib/hash";
import { announceIssue, notifyLocalWrite } from "@/notes/store";
import { isBlankHtml } from "@/notes/text";
import { coalesce, type PendingMutation } from "@/sync/outbox";
import { connectionProblem, duplicateNode, edgeCreateFields, nodeCreateFields, planRowDelete } from "./changes";

/**
 * Everything the phone does to a canvas, offline first — like
 * src/notes/store.ts for notes: the local rows change at once (the canvas
 * reads only SQLite) and a change is queued for the server.
 *
 * An idea the server has confirmed sends only what changed, judged against
 * the server's `updated_at` it was based on; one made here and not confirmed
 * yet sends all of itself, so if its create never made it, the next change
 * is the create. Text changes carry the hash of the text they started from:
 * a text changed on the web meanwhile is kept, and the phone's becomes a
 * sibling idea (the server's rule, lib/sync.ts).
 */

const TABLES: Table[] = ["issues", "canvas_nodes", "canvas_edges", "outbox"];

export type { LocalNode };

export interface IdeaEdit {
  content?: string;
  color?: string | null;
  width?: number;
  x?: number;
  y?: number;
}

type NodeField = keyof IdeaEdit;
const NODE_FIELDS: NodeField[] = ["content", "color", "width", "x", "y"];

async function queueNodeChange(
  db: SQLiteDatabase,
  before: LocalNode,
  next: LocalNode,
  diff: IdeaEdit,
  previousContent?: string
): Promise<void> {
  const queue = await repo.queueFor(db, "canvas_node", before.id);
  const last = queue[queue.length - 1] ?? null;
  const fields: Record<string, unknown> = before.server_updated_at ? { ...diff } : nodeCreateFields(next);

  let baseHash: string | null = null;
  if ("content" in diff && before.server_updated_at) {
    const folds = last?.op === "upsert" && last.attempts === 0 && "content" in last.fields;
    if (!folds) baseHash = await textHash(previousContent ?? before.content);
  }
  const change = { fields, base_updated_at: before.server_updated_at, base_hash: baseHash, title_hint: null };
  const merged = coalesce(last, change);
  if (merged.action === "merge" && last) await repo.rewritePending(db, last.seq, merged);
  else await repo.enqueue(db, { mutation_id: newId(), entity: "canvas_node", op: "upsert", entity_id: before.id, ...change });
}

async function editIn(db: SQLiteDatabase, id: string, edit: IdeaEdit, previousContent?: string): Promise<boolean> {
  const row = await repo.getNode(db, id);
  if (!row) return false;
  const diff: IdeaEdit = {};
  for (const key of NODE_FIELDS) {
    if (edit[key] !== undefined && edit[key] !== row[key]) (diff as Record<string, unknown>)[key] = edit[key];
  }
  if (Object.keys(diff).length === 0) return false;
  const next: LocalNode = { ...row, ...diff, updated_at: new Date().toISOString() };
  await repo.putLocalNode(db, next);
  await queueNodeChange(db, row, next, diff, previousContent);
  return true;
}

/** Writes an idea the phone just made and queues its create. */
async function insertIdea(db: SQLiteDatabase, node: LocalNode): Promise<void> {
  // The server accepts an idea only on a canvas it has.
  await announceIssue(db, node.issue_id);
  await repo.putLocalNode(db, node);
  await repo.enqueue(db, {
    mutation_id: newId(),
    entity: "canvas_node",
    op: "upsert",
    entity_id: node.id,
    fields: nodeCreateFields(node),
    base_updated_at: null,
    base_hash: null,
    title_hint: null,
  });
}

/** A new idea on a canvas, where the person put it. Queued at once — like the web, which creates it before it is typed in. */
export async function createIdea(
  issueId: string,
  at: { x: number; y: number },
  opts: { content?: string; width?: number } = {}
): Promise<string> {
  const id = newId();
  await write(TABLES, async (db) => {
    const now = new Date().toISOString();
    await insertIdea(db, {
      id,
      issue_id: issueId,
      content: opts.content ?? "",
      color: null,
      x: at.x,
      y: at.y,
      width: opts.width ?? NODE_DEFAULT_WIDTH,
      height: NODE_DEFAULT_HEIGHT,
      created_at: now,
      updated_at: now,
      server_updated_at: null,
    });
  });
  notifyLocalWrite();
  return id;
}

/**
 * A copy of an idea as the phone has it now (duplicateNode): its words,
 * colour and width, a step down and to the right, no connections. Returns
 * the copy's id, or null if the idea is gone.
 */
export async function duplicateIdea(sourceId: string): Promise<string | null> {
  const id = newId();
  const made = await write(TABLES, async (db) => {
    const src = await repo.getNode(db, sourceId);
    if (!src) return false;
    await insertIdea(db, duplicateNode(src, id, new Date().toISOString()));
    return true;
  });
  if (!made) return null;
  notifyLocalWrite();
  return id;
}

/**
 * Changes an idea. `previousContent` is the text the editor started this
 * change from — what a conflict is judged against, not whatever the row
 * holds by now (see editIssue).
 */
export async function editIdea(id: string, edit: IdeaEdit, opts: { previousContent?: string } = {}): Promise<void> {
  const changed = await write(TABLES, (db) => editIn(db, id, edit, opts.previousContent));
  if (changed) notifyLocalWrite();
}

/** Where a moved card (or several) landed — one write for the whole gesture. */
export async function moveIdeas(moves: { id: string; x: number; y: number }[]): Promise<void> {
  const changed = await write(TABLES, async (db) => {
    let any = false;
    for (const m of moves) {
      if (await editIn(db, m.id, { x: m.x, y: m.y })) any = true;
    }
    return any;
  });
  if (changed) notifyLocalWrite();
}

// ─── Deleting, with Undo ─────────────────────────────────────────────────────

/** What an Undo needs to put an idea back as it was. */
export interface IdeaSnapshot {
  node: LocalNode;
  edges: SyncEdgeRow[];
  /** Changes not sent yet that the delete dropped — the idea's and its connections'. */
  dropped: PendingMutation[];
  /** The delete queued for it, when one was. */
  deleteId: string | null;
}

async function dropAll(db: SQLiteDatabase, list: PendingMutation[]): Promise<void> {
  for (const m of list) await repo.dropPending(db, m.mutation_id);
}

async function deleteIn(db: SQLiteDatabase, id: string): Promise<IdeaSnapshot | null> {
  const node = await repo.getNode(db, id);
  if (!node) return null;
  const edges = await repo.edgesOf(db, id);
  const dropped: PendingMutation[] = [];

  // Its connections go with it: the server deletes them in cascade, so only
  // what was never sent of them is dropped here.
  for (const e of edges) {
    const q = await repo.queueFor(db, "canvas_edge", e.id);
    const unsent = q.filter((m) => m.attempts === 0);
    await dropAll(db, unsent);
    dropped.push(...unsent);
  }

  const plan = planRowDelete(!!node.server_updated_at, await repo.queueFor(db, "canvas_node", id));
  await dropAll(db, plan.dropped);
  dropped.push(...plan.dropped);
  let deleteId: string | null = null;
  if (plan.action === "delete") {
    deleteId = newId();
    await repo.enqueue(db, {
      mutation_id: deleteId,
      entity: "canvas_node",
      op: "delete",
      entity_id: id,
      fields: {},
      base_updated_at: node.server_updated_at,
      // The text the server has, as far as the phone knows: a text changed
      // on the web since is not deleted unseen — the server refuses.
      base_hash: plan.baseHashFromQueue ?? (await textHash(node.content)),
      title_hint: null,
    });
  }
  await repo.removeNode(db, id);
  return { node, edges, dropped, deleteId };
}

/** Deletes an idea and its connections. Returns what an Undo needs. */
export async function deleteIdea(id: string): Promise<IdeaSnapshot | null> {
  const snap = await write(TABLES, (db) => deleteIn(db, id));
  if (snap) notifyLocalWrite();
  return snap;
}

/**
 * Puts a deleted idea back. If its delete has not left yet, it is simply
 * taken back, with every change it dropped. If it has, the idea and its
 * connections are created again under the same ids — judged against the
 * text the phone had, so a text the web changed meanwhile is not overwritten.
 */
export async function restoreIdea(snap: IdeaSnapshot): Promise<void> {
  await write(TABLES, async (db) => {
    const queue = snap.deleteId ? await repo.queueFor(db, "canvas_node", snap.node.id) : [];
    const del = queue.find((m) => m.mutation_id === snap.deleteId);
    const stillHere = !snap.deleteId || (del && del.attempts === 0);

    if (stillHere) {
      if (del) await repo.dropPending(db, del.mutation_id);
      await repo.putLocalNode(db, snap.node);
      for (const e of snap.edges) await repo.putEdge(db, e);
      for (const m of snap.dropped) {
        const { seq: _seq, attempts: _attempts, ...rest } = m;
        await repo.enqueue(db, rest);
      }
    } else {
      const node: LocalNode = { ...snap.node, server_updated_at: null, updated_at: new Date().toISOString() };
      await repo.putLocalNode(db, node);
      await repo.enqueue(db, {
        mutation_id: newId(),
        entity: "canvas_node",
        op: "upsert",
        entity_id: node.id,
        fields: nodeCreateFields(node),
        base_updated_at: null,
        base_hash: await textHash(snap.node.content),
        title_hint: null,
      });
      for (const e of snap.edges) {
        await repo.putEdge(db, e);
        await queueEdgeCreate(db, e);
      }
    }
  });
  notifyLocalWrite();
}

/**
 * Closing the editor on an idea left empty throws it away, as on the web.
 * True when it did.
 */
export async function discardIdeaIfBlank(id: string): Promise<boolean> {
  const snap = await write(TABLES, async (db) => {
    const node = await repo.getNode(db, id);
    if (!node || !isBlankHtml(node.content)) return null;
    return deleteIn(db, id);
  });
  if (snap) notifyLocalWrite();
  return !!snap;
}

// ─── Connections ─────────────────────────────────────────────────────────────

async function queueEdgeCreate(db: SQLiteDatabase, e: SyncEdgeRow): Promise<void> {
  await repo.enqueue(db, {
    mutation_id: newId(),
    entity: "canvas_edge",
    op: "upsert",
    entity_id: e.id,
    fields: edgeCreateFields(e),
    base_updated_at: null,
    base_hash: null,
    title_hint: null,
  });
}

/**
 * Connects two ideas. A side is pinned when the line was dragged from (or
 * dropped on) a dot; null lets the canvas choose. Null when the connection
 * cannot be made (to itself, or one that exists).
 */
export async function createConnection(input: {
  issueId: string;
  sourceId: string;
  targetId: string;
  sourceSide: Side | null;
  targetSide: Side | null;
}): Promise<string | null> {
  const id = await write(TABLES, async (db) => {
    const existing = await db.getAllAsync<{ source_id: string; target_id: string }>(
      "SELECT source_id, target_id FROM canvas_edges WHERE issue_id = ?",
      input.issueId
    );
    if (connectionProblem(existing, input.sourceId, input.targetId)) return null;
    const now = new Date().toISOString();
    const edge: SyncEdgeRow = {
      id: newId(),
      issue_id: input.issueId,
      source_id: input.sourceId,
      target_id: input.targetId,
      source_side: input.sourceSide,
      target_side: input.targetSide,
      created_at: now,
      updated_at: now,
    };
    await repo.putEdge(db, edge);
    await queueEdgeCreate(db, edge);
    return edge.id;
  });
  if (id) notifyLocalWrite();
  return id;
}

export interface ConnectionSnapshot {
  edge: SyncEdgeRow;
  dropped: PendingMutation[];
  deleteId: string | null;
}

export async function deleteConnection(id: string): Promise<ConnectionSnapshot | null> {
  const snap = await write(TABLES, async (db) => {
    const edge = await repo.getEdge(db, id);
    if (!edge) return null;
    const queue = await repo.queueFor(db, "canvas_edge", id);
    // A connection made here whose create never left: forget it. Any other
    // (the server's, or one whose create is on its way) is deleted there.
    const createdHere = queue.some((m) => m.op === "upsert" && "source_id" in m.fields);
    const plan = planRowDelete(!createdHere, queue);
    await dropAll(db, plan.dropped);
    let deleteId: string | null = null;
    if (plan.action === "delete") {
      deleteId = newId();
      await repo.enqueue(db, {
        mutation_id: deleteId,
        entity: "canvas_edge",
        op: "delete",
        entity_id: id,
        fields: {},
        base_updated_at: null,
        base_hash: null,
        title_hint: null,
      });
    }
    await repo.removeEdge(db, id);
    return { edge, dropped: plan.dropped, deleteId };
  });
  if (snap) notifyLocalWrite();
  return snap;
}

export async function restoreConnection(snap: ConnectionSnapshot): Promise<void> {
  await write(TABLES, async (db) => {
    // Both ends must still be here; a connection to a deleted idea stays gone.
    const ends = await db.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM canvas_nodes WHERE id IN (?, ?)",
      snap.edge.source_id,
      snap.edge.target_id
    );
    if ((ends?.n ?? 0) < 2) return;
    const queue = snap.deleteId ? await repo.queueFor(db, "canvas_edge", snap.edge.id) : [];
    const del = queue.find((m) => m.mutation_id === snap.deleteId);
    await repo.putEdge(db, snap.edge);
    if (!snap.deleteId || (del && del.attempts === 0)) {
      if (del) await repo.dropPending(db, del.mutation_id);
      for (const m of snap.dropped) {
        const { seq: _seq, attempts: _attempts, ...rest } = m;
        await repo.enqueue(db, rest);
      }
    } else {
      await queueEdgeCreate(db, snap.edge);
    }
  });
  notifyLocalWrite();
}

/** Pins a connection's ends to sides, or (null) hands them back to the canvas. */
export async function setConnectionSides(id: string, sides: { source_side?: Side | null; target_side?: Side | null }): Promise<void> {
  const changed = await write(TABLES, async (db) => {
    const edge = await repo.getEdge(db, id);
    if (!edge) return false;
    const diff: Record<string, unknown> = {};
    if (sides.source_side !== undefined && sides.source_side !== edge.source_side) diff.source_side = sides.source_side;
    if (sides.target_side !== undefined && sides.target_side !== edge.target_side) diff.target_side = sides.target_side;
    if (Object.keys(diff).length === 0) return false;
    const next = { ...edge, ...diff, updated_at: new Date().toISOString() } as SyncEdgeRow;
    await repo.putEdge(db, next);

    const queue = await repo.queueFor(db, "canvas_edge", id);
    const last = queue[queue.length - 1] ?? null;
    const change = { fields: diff, base_updated_at: null, base_hash: null, title_hint: null };
    const merged = coalesce(last, change);
    if (merged.action === "merge" && last) await repo.rewritePending(db, last.seq, merged);
    else await repo.enqueue(db, { mutation_id: newId(), entity: "canvas_edge", op: "upsert", entity_id: id, ...change });
    return true;
  });
  if (changed) notifyLocalWrite();
}
