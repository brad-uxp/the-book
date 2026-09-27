/**
 * Geometry shared by canvas views.
 *
 * Kept out of the components so it is testable on its own: it is the piece
 * that decides where a line leaves a card, and getting it wrong reads as "the
 * canvas is broken" long before anyone can say why.
 */

/** Cards snap to this grid while dragging and resizing. */
export const GRID_SIZE = 8;

/**
 * Coordinates are persisted as doubles, so the only real risk is a NaN or an
 * absurd value from a broken client putting a card somewhere the user cannot
 * pan to. The bound is far larger than any layout a human would build by hand.
 */
export const CANVAS_BOUND = 1_000_000;

/** Rounds a coordinate onto the drag grid. */
export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

// ── Edge geometry ────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Side = "top" | "right" | "bottom" | "left";

export interface EdgeAnchor {
  x: number;
  y: number;
  side: Side;
}

/**
 * Where a line drawn between two cards should leave the first one.
 *
 * Edges float rather than being tied to a fixed handle: the anchor is
 * recomputed from the two boxes, so dragging a card never leaves a line coming
 * out of its wrong side and looping around. That also means nothing about
 * which side an edge uses has to be stored — the geometry decides.
 *
 * This is the ray from one center to the other, clipped to the first box.
 */
export function edgeAnchor(from: Rect, to: Rect): EdgeAnchor {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = to.x + to.width / 2 - cx;
  const dy = to.y + to.height / 2 - cy;

  // Concentric boxes have no meaningful direction; pick one deterministically
  // rather than dividing by zero.
  if (dx === 0 && dy === 0) {
    return { x: from.x + from.width, y: cy, side: "right" };
  }

  const halfW = from.width / 2;
  const halfH = from.height / 2;

  // How far along the ray each pair of edges sits. The nearer one is the side
  // the ray actually crosses.
  const toVertical = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const toHorizontal = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(toVertical, toHorizontal);

  const side: Side =
    toVertical <= toHorizontal
      ? dx > 0
        ? "right"
        : "left"
      : dy > 0
        ? "bottom"
        : "top";

  return { x: cx + dx * t, y: cy + dy * t, side };
}
