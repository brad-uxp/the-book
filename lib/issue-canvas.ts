/**
 * Geometry for the issues canvas view.
 *
 * Kept out of the component so the placement rule is testable on its own: it
 * is the piece that decides where an issue the user has never dragged shows
 * up, and getting it wrong means cards land on top of each other or off
 * screen — both of which read as "the canvas lost my layout".
 */

/**
 * Card footprint, in canvas units. Matches the CSS of the canvas node.
 * Width, height and gap are all multiples of GRID_SIZE so auto-layout lands
 * on the same grid the drag snaps to.
 *
 * CARD_HEIGHT is the TALLEST a card gets — a two-line title with a footer.
 * The card itself grows to its content, so a one-line title makes a shorter
 * card; this is the upper bound, which is what auto-layout needs to space rows
 * without ever overlapping, and what edge geometry falls back to before React
 * Flow has measured the real node.
 */
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 80;

/** Gap between auto-placed cards. */
export const CARD_GAP = 32;

/** Cards snap to this grid while dragging. */
export const GRID_SIZE = 8;

/** How many auto-placed cards per row before wrapping. */
export const AUTO_LAYOUT_COLUMNS = 5;

/**
 * Coordinates are persisted as doubles, so the only real risk is a NaN or an
 * absurd value from a broken client putting a card somewhere the user cannot
 * pan to. The bound is far larger than any layout a human would build by hand.
 */
export const CANVAS_BOUND = 1_000_000;

export interface Placeable {
  id: string;
  canvas_x: number | null;
  canvas_y: number | null;
}

export interface CanvasPosition {
  id: string;
  x: number;
  y: number;
}

/** A position is only usable if both axes are real, finite numbers in range. */
export function isPlaced(issue: Placeable): boolean {
  return (
    typeof issue.canvas_x === "number" &&
    typeof issue.canvas_y === "number" &&
    Number.isFinite(issue.canvas_x) &&
    Number.isFinite(issue.canvas_y) &&
    Math.abs(issue.canvas_x) <= CANVAS_BOUND &&
    Math.abs(issue.canvas_y) <= CANVAS_BOUND
  );
}

/**
 * Positions for the issues that have never been placed on the canvas.
 *
 * Returns only those — issues the user has already dragged are left exactly
 * where they are, which is the whole point of persisting the layout. New ones
 * are laid out in a grid *below* everything already on the canvas, so an issue
 * created from the board never lands underneath a card the user positioned by
 * hand.
 *
 * Deterministic: the same input order always yields the same coordinates, so
 * two tabs opening the canvas at once persist the same layout instead of
 * fighting each other.
 */
export function layoutUnplaced(
  issues: Placeable[],
  columns: number = AUTO_LAYOUT_COLUMNS
): CanvasPosition[] {
  const unplaced = issues.filter((i) => !isPlaced(i));
  if (unplaced.length === 0) return [];

  const cols = Math.max(1, Math.floor(columns));
  const placed = issues.filter(isPlaced);

  // Start below the lowest existing card, aligned to the leftmost one.
  const originX = placed.length
    ? Math.min(...placed.map((i) => i.canvas_x as number))
    : 0;
  const originY = placed.length
    ? Math.max(...placed.map((i) => i.canvas_y as number)) +
      CARD_HEIGHT +
      CARD_GAP
    : 0;

  // Not snapped: the origin comes from coordinates the drag layer already
  // snapped, and the step is a multiple of GRID_SIZE, so snapping again would
  // only nudge the whole block off the position the user actually chose.
  return unplaced.map((issue, idx) => ({
    id: issue.id,
    x: originX + (idx % cols) * (CARD_WIDTH + CARD_GAP),
    y: originY + Math.floor(idx / cols) * (CARD_HEIGHT + CARD_GAP),
  }));
}

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
