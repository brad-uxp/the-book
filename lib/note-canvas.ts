/**
 * Sizes and limits for the ideas on a canvas note.
 *
 * Shared by the validation schemas and the canvas itself, so the card the user
 * can drag to a size is exactly the card the API will accept.
 */

import { snapToGrid } from "./canvas-geometry";

/** A new idea. Room for a heading and a few lines before it scrolls. */
export const NODE_DEFAULT_WIDTH = 280;
export const NODE_DEFAULT_HEIGHT = 160;

/**
 * The idea a text note's description becomes when the note turns into a
 * canvas. Larger than a fresh one: it arrives already holding a document.
 */
export const SEED_NODE_WIDTH = 480;
export const SEED_NODE_HEIGHT = 360;

/** Below this a card cannot show a line of text and a resize handle. */
export const NODE_MIN_WIDTH = 160;
export const NODE_MIN_HEIGHT = 64;

/** Far past any screen; only stops a broken client storing a runaway size. */
export const NODE_MAX_SIZE = 4000;

/**
 * Per-idea content ceiling, in characters of HTML. A description has no
 * limit, but a node is meant to be one idea — and this keeps a single
 * runaway paste from turning every autosave into a megabyte request.
 */
export const NODE_CONTENT_MAX = 200_000;

/** Positions and sizes moved in one gesture travel as one write. */
export const LAYOUT_BATCH_MAX = 1000;

/**
 * Where a node lands so that its centre is at a point — what "create it where
 * I clicked" means — snapped onto the drag grid.
 */
export function nodeOriginAt(
  point: { x: number; y: number },
  width: number = NODE_DEFAULT_WIDTH,
  height: number = NODE_DEFAULT_HEIGHT
): { x: number; y: number } {
  return {
    x: snapToGrid(point.x - width / 2),
    y: snapToGrid(point.y - height / 2),
  };
}
