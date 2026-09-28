import { prisma } from "@/lib/db";
import { isCanvasNote, isBlankHtml } from "@/lib/notes";
import { plainTextSnippet } from "@/lib/mentions";
import { EDGE_SELECT, NODE_SELECT } from "@/lib/note-canvas-server";
import type { Db, WriteContext } from "@/lib/issues-service";
import type { Side } from "@/lib/canvas-geometry";

/**
 * Writing what is drawn on a canvas note: ideas and connections. Shared by
 * the REST routes under /api/issues/[id]/canvas and the phone's sync, like
 * lib/issues-service.ts is for issues.
 *
 * What is audited is deliberate and the same on both ways in: only deleting
 * an idea that had words. An idea is written and rewritten constantly, and a
 * row per edit or per drag would bury the history that matters; a deletion is
 * the write that loses words.
 *
 * Prisma's errors are thrown for the caller to map: P2002 for an id or a
 * connection that already exists, P2003 for a connection whose end is not an
 * idea of that canvas (the compound foreign keys refuse it), P2025 for a row
 * that is not there.
 */

/** The note an idea belongs to, and whether it is a canvas; null when there is no such issue. */
export async function canvasOf(
  db: Db,
  issueId: string
): Promise<{ id: string; title: string; isCanvas: boolean } | null> {
  const issue = await db.issue.findUnique({
    where: { id: issueId },
    select: { id: true, title: true, category: true, note_format: true },
  });
  if (!issue) return null;
  return { id: issue.id, title: issue.title, isCanvas: isCanvasNote(issue) };
}

export interface NodeCreate {
  /** A UUID chosen by the client, so the idea's key never changes under the cursor. */
  id?: string;
  issue_id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: string;
  color?: string | null;
}

/** Creates an idea. The caller has checked that `issue_id` is a canvas note. */
export function createNode(db: Db, data: NodeCreate) {
  return db.canvasNode.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      issue_id: data.issue_id,
      x: data.x,
      y: data.y,
      ...(data.width !== undefined ? { width: data.width } : {}),
      ...(data.height !== undefined ? { height: data.height } : {}),
      content: data.content ?? "",
      color: data.color ?? null,
    },
    select: NODE_SELECT,
  });
}

export interface NodeEdit {
  content?: string;
  color?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * Edits the fields present in `data`. Scoped by issue_id in the where-clause,
 * so a node id from another canvas is a P2025 rather than an edit to someone
 * else's idea.
 */
export function updateNode(db: Db, issueId: string, nodeId: string, data: NodeEdit) {
  const has = (key: keyof NodeEdit) => Object.hasOwn(data, key);
  return db.canvasNode.update({
    where: { id: nodeId, issue_id: issueId },
    data: {
      ...(has("content") ? { content: data.content } : {}),
      ...(has("color") ? { color: data.color ?? null } : {}),
      ...(has("x") ? { x: data.x } : {}),
      ...(has("y") ? { y: data.y } : {}),
      ...(has("width") ? { width: data.width } : {}),
      ...(has("height") ? { height: data.height } : {}),
    },
    select: NODE_SELECT,
  });
}

/**
 * Where ideas sit and how big they are, in one batch — a gesture that moved a
 * selection is one write. An id that is gone or belongs to another canvas is
 * a no-op, not a failure that throws away the rest of the gesture.
 *
 * Its own batch transaction rather than a `db` argument: a drag can move a
 * thousand cards, and one round trip per card inside an interactive
 * transaction would run into its timeout.
 */
export async function updateLayout(
  issueId: string,
  nodes: { id: string; x: number; y: number; width?: number; height?: number }[]
): Promise<number> {
  // Last write wins for a repeated id, so the batch holds one update each.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const results = await prisma.$transaction(
    [...byId.values()].map((n) =>
      prisma.canvasNode.updateMany({
        where: { id: n.id, issue_id: issueId },
        data: {
          x: n.x,
          y: n.y,
          ...(n.width !== undefined ? { width: n.width } : {}),
          ...(n.height !== undefined ? { height: n.height } : {}),
        },
      })
    )
  );
  return results.reduce((sum, r) => sum + r.count, 0);
}

/**
 * Removes an idea and, by cascade, its connections. Audited with its content
 * and connections in `before` — the way back from a deletion nobody meant —
 * unless it had no words: a card created and abandoned unwritten is noise.
 */
export async function deleteNode(db: Db, issueId: string, nodeId: string, ctx: WriteContext) {
  // Read first: after the delete the edges are gone with it, and a record of
  // a removed idea should say what it was connected to.
  const edges = await db.canvasEdge.findMany({
    where: { issue_id: issueId, OR: [{ source_id: nodeId }, { target_id: nodeId }] },
    select: EDGE_SELECT,
  });

  const node = await db.canvasNode.delete({
    where: { id: nodeId, issue_id: issueId },
    select: { ...NODE_SELECT, issue: { select: { title: true } } },
  });

  const { issue, ...removed } = node;
  if (!isBlankHtml(removed.content)) {
    const snippet = plainTextSnippet(removed.content);
    ctx.audit({
      entity_type: "canvas_node",
      entity_id: nodeId,
      entity_name: snippet ? `${issue.title} › ${snippet}` : issue.title,
      action: "delete",
      actor_email: ctx.actor,
      before: { issue_id: issueId, ...removed, edges },
    });
  }
  return removed;
}

export interface EdgeCreate {
  id?: string;
  issue_id: string;
  source_id: string;
  target_id: string;
  source_side?: Side | null;
  target_side?: Side | null;
}

/** No check-then-insert: the database refuses a duplicate or a foreign end. */
export function createEdge(db: Db, data: EdgeCreate) {
  return db.canvasEdge.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      issue_id: data.issue_id,
      source_id: data.source_id,
      target_id: data.target_id,
      source_side: data.source_side ?? null,
      target_side: data.target_side ?? null,
    },
    select: EDGE_SELECT,
  });
}

export interface EdgeUpdate {
  source_id?: string;
  target_id?: string;
  source_side?: Side | null;
  target_side?: Side | null;
}

/** An update that would connect an idea to itself — refused before the CHECK would be. */
export class SelfLinkError extends Error {
  constructor() {
    super("An idea cannot connect to itself");
  }
}

/**
 * Moves a connection's ends or pins its sides. Scoped by issue_id: an edge of
 * another canvas is a P2025 from here. A new end must be an idea of the same
 * canvas (the compound foreign keys, P2003), and must not duplicate another
 * connection (the unique index, P2002).
 */
export async function updateEdge(db: Db, issueId: string, edgeId: string, data: EdgeUpdate) {
  if (data.source_id !== undefined || data.target_id !== undefined) {
    const current = await db.canvasEdge.findFirst({
      where: { id: edgeId, issue_id: issueId },
      select: { source_id: true, target_id: true },
    });
    const source = data.source_id ?? current?.source_id;
    const target = data.target_id ?? current?.target_id;
    if (current && source === target) throw new SelfLinkError();
  }
  return db.canvasEdge.update({
    where: { id: edgeId, issue_id: issueId },
    data,
    select: EDGE_SELECT,
  });
}

/** Scoped by issue_id: an edge of another canvas is a P2025 from here. */
export function deleteEdge(db: Db, issueId: string, edgeId: string) {
  return db.canvasEdge.delete({ where: { id: edgeId, issue_id: issueId } });
}
