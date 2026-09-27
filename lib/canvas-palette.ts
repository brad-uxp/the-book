/**
 * The palette a canvas card can be painted in.
 *
 * Keys, not hex values, are what gets stored. Two reasons: a free colour
 * eventually produces a card nobody can read, and a key can be re-tuned for
 * both themes later without touching a single row.
 *
 * The tones are mid-range on purpose — they have to carry text on a
 * translucent tint of themselves, over a light background and a dark one. It
 * is the same treatment the client chips already use elsewhere in the app.
 */
export const CANVAS_COLORS = {
  slate: { label: "Slate", hex: "#94a3b8" },
  blue: { label: "Blue", hex: "#60a5fa" },
  green: { label: "Green", hex: "#34d399" },
  amber: { label: "Amber", hex: "#fbbf24" },
  red: { label: "Red", hex: "#f87171" },
  violet: { label: "Violet", hex: "#a78bfa" },
  pink: { label: "Pink", hex: "#f472b6" },
} as const;

export type CanvasColor = keyof typeof CANVAS_COLORS;

export const CANVAS_COLOR_KEYS = Object.keys(CANVAS_COLORS) as CanvasColor[];

export const DEFAULT_CANVAS_COLOR: CanvasColor = "slate";

export function isCanvasColor(value: string): value is CanvasColor {
  return Object.prototype.hasOwnProperty.call(CANVAS_COLORS, value);
}

/**
 * The palette entry for a stored key.
 *
 * Falls back rather than throwing: a row written before a palette entry was
 * renamed should still draw, in some colour, instead of taking the canvas
 * down with it.
 */
export function canvasColor(value: string): { label: string; hex: string } {
  return isCanvasColor(value)
    ? CANVAS_COLORS[value]
    : CANVAS_COLORS[DEFAULT_CANVAS_COLOR];
}
