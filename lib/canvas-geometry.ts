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

export const SIDES = ["top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];

export function isSide(value: unknown): value is Side {
  return (SIDES as readonly unknown[]).includes(value);
}

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

/** The middle of one side of a box: where a connection pinned to that side meets it. */
export function sideAnchor(box: Rect, side: Side): EdgeAnchor {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y, side };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height / 2, side };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height, side };
    case "left":
      return { x: box.x, y: box.y + box.height / 2, side };
  }
}

/**
 * Both ends of a connection. An end pinned to a side sits in the middle of
 * that side; an end left free floats as before — but aimed at the other end's
 * pinned point when there is one, not at the other card's centre, so the line
 * does not bend away from where it is going.
 */
export function connectionAnchors(
  from: Rect,
  to: Rect,
  sourceSide: Side | null = null,
  targetSide: Side | null = null
): { start: EdgeAnchor; end: EdgeAnchor } {
  const point = (a: EdgeAnchor): Rect => ({ x: a.x, y: a.y, width: 0, height: 0 });
  const pinnedStart = sourceSide ? sideAnchor(from, sourceSide) : null;
  const pinnedEnd = targetSide ? sideAnchor(to, targetSide) : null;
  return {
    start: pinnedStart ?? edgeAnchor(from, pinnedEnd ? point(pinnedEnd) : to),
    end: pinnedEnd ?? edgeAnchor(to, pinnedStart ? point(pinnedStart) : from),
  };
}
