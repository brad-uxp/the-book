/**
 * The palette a canvas chip can be painted in.
 *
 * Keys, not hex values, are what gets stored. Two reasons: a free colour
 * eventually produces a chip nobody can read, and a key can be re-tuned for
 * both themes later without touching a single row.
 *
 * The tones are mid-range on purpose — they have to carry the text on a
 * translucent tint of themselves, over a light background and a dark one. It
 * is the same treatment the client chips already use elsewhere in the app.
 */
export const LABEL_COLORS = {
  slate: { label: "Slate", hex: "#94a3b8" },
  blue: { label: "Blue", hex: "#60a5fa" },
  green: { label: "Green", hex: "#34d399" },
  amber: { label: "Amber", hex: "#fbbf24" },
  red: { label: "Red", hex: "#f87171" },
  violet: { label: "Violet", hex: "#a78bfa" },
  pink: { label: "Pink", hex: "#f472b6" },
} as const;

export type LabelColor = keyof typeof LABEL_COLORS;

export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColor[];

export const DEFAULT_LABEL_COLOR: LabelColor = "slate";

/** Matches the column width. Chips are labels, not paragraphs. */
export const LABEL_MAX_LENGTH = 200;

/** How wide a chip is allowed to get before its text wraps. */
export const LABEL_MAX_WIDTH = 260;

export function isLabelColor(value: string): value is LabelColor {
  return Object.prototype.hasOwnProperty.call(LABEL_COLORS, value);
}

/**
 * The palette entry for a stored key.
 *
 * Falls back rather than throwing: a row written before a palette entry was
 * renamed should still draw, in some colour, instead of taking the canvas
 * down with it.
 */
export function labelColor(value: string): { label: string; hex: string } {
  return isLabelColor(value)
    ? LABEL_COLORS[value]
    : LABEL_COLORS[DEFAULT_LABEL_COLOR];
}

/** A chip on the canvas. Mirrors the CanvasLabel row. */
export interface CanvasLabel {
  id: string;
  text: string;
  color: string;
  canvas_x: number;
  canvas_y: number;
}
