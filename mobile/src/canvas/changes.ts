/**
 * What the phone queues for the server when an idea or a connection changes —
 * the rules, without the database. The SQL side is src/canvas/store.ts.
 *
 * Pure (no React Native), so `node --test` runs it.
 */
import type { SyncEdgeRow, SyncNodeRow } from "../../../lib/sync-protocol.ts";
import type { PendingMutation } from "../sync/outbox.ts";

/** An idea's fields as a create needs them — for an idea the server has never seen. */
export function nodeCreateFields(n: Pick<SyncNodeRow, "issue_id" | "content" | "color" | "x" | "y" | "width" | "height">) {
  return { issue_id: n.issue_id, content: n.content, color: n.color, x: n.x, y: n.y, width: n.width, height: n.height };
}

export function edgeCreateFields(e: Pick<SyncEdgeRow, "issue_id" | "source_id" | "target_id" | "source_side" | "target_side">) {
  return {
    issue_id: e.issue_id,
    source_id: e.source_id,
    target_id: e.target_id,
    source_side: e.source_side ?? null,
    target_side: e.target_side ?? null,
  };
}

/**
 * Why a connection cannot be made, or null. The same two rules the web
 * enforces (and the database): no idea connects to itself, and one direction
 * between two ideas exists once. The other direction is a different
 * connection.
 */
export function connectionProblem(
  edges: Pick<SyncEdgeRow, "source_id" | "target_id">[],
  sourceId: string,
  targetId: string
): "self" | "duplicate" | null {
  if (sourceId === targetId) return "self";
  return edges.some((e) => e.source_id === sourceId && e.target_id === targetId) ? "duplicate" : null;
}

/**
 * What deleting a row does to its queue.
 *
 *  - `forget`: the server has never seen it (no confirmation, nothing sent) —
 *    its queued changes are dropped and nothing goes to the server.
 *  - `delete`: a delete is queued. Changes not sent yet are dropped first —
 *    they would be undone anyway — and the delete is judged against the text
 *    the server has: the base of the first dropped text change when there is
 *    one (the phone's row already shows the edit), else the row's text.
 *
 * `dropped` are kept so an Undo can put them back as they were.
 */
export function planRowDelete(
  confirmed: boolean,
  queue: PendingMutation[]
): { action: "forget" | "delete"; dropped: PendingMutation[]; baseHashFromQueue: string | null } {
  const unsent = queue.filter((m) => m.attempts === 0);
  if (!confirmed && unsent.length === queue.length) {
    return { action: "forget", dropped: unsent, baseHashFromQueue: null };
  }
  const textChange = unsent.find(
    (m) => m.op === "upsert" && ("content" in m.fields || "description" in m.fields) && m.base_hash
  );
  return { action: "delete", dropped: unsent, baseHashFromQueue: textChange?.base_hash ?? null };
}

/**
 * Where an idea made by dropping a connection on empty canvas goes: centred
 * on the finger horizontally, its top a little above it, so the new card
 * sits where the line ends.
 */
export function newIdeaOrigin(point: { x: number; y: number }, width: number): { x: number; y: number } {
  return { x: point.x - width / 2, y: point.y - 24 };
}
