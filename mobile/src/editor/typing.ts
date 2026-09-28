/**
 * Typing on the editor page, as editor-web/main.ts tracks it to keep toolbar
 * formats from racing the keyboard. Pure and dependency-free: compiled into
 * the page, tested here.
 */

import type { ToolbarAction } from "./protocol";

/** One letter (or composition update) as it came in: when, and where it went. */
export interface TypedLetter {
  /** Date.now() when it came in. */
  at: number;
  /** Where it went in, mapped through every change since. */
  pos: number;
}

/** How long typed letters are remembered: far longer than a press takes to cross. */
export const TYPED_MEMORY_MS = 3000;

/** The toolbar actions that toggle a mark, and the mark each one toggles. */
export const MARK_ACTIONS: Partial<Record<ToolbarAction, "bold" | "italic" | "highlight">> = {
  bold: "bold",
  italic: "italic",
  highlight: "highlight",
};

/** The letters worth remembering at `now`. */
export function recentLetters(letters: readonly TypedLetter[], now: number): TypedLetter[] {
  return letters.filter((l) => now - l.at <= TYPED_MEMORY_MS);
}

/**
 * The letters a mark toggled from the toolbar should also cover.
 *
 * A press and its message are not simultaneous: the message crosses from the
 * native side after the button is released, and a fast typist's next letters
 * can reach the page first — composed by the keyboard or committed one by
 * one. Letters that came in after the press were typed after it, so they take
 * the mark: from the first of them up to the cursor, as long as they sit
 * there together. Letters from before the press keep what they have — B
 * tapped in the middle of a word marks only what comes next, as on the web.
 */
export function lateTypedRange(
  letters: readonly TypedLetter[],
  pressedAt: number | undefined,
  cursor: number
): { from: number; to: number } | null {
  if (pressedAt === undefined) return null;
  const late = letters.filter((l) => l.at >= pressedAt);
  if (late.length === 0) return null;
  const from = Math.min(...late.map((l) => l.pos));
  // Typed somewhere else in the meantime: not a stretch ending at the cursor.
  if (from >= cursor || late.some((l) => l.pos >= cursor)) return null;
  return { from, to: cursor };
}

/**
 * When a toolbar button was touched, as Date.now() — the clock the page uses
 * for typed letters. React Native stamps touch events with the monotonic
 * clock that `performance.now()` also reads, and the handler runs a little
 * after the touch (6–17 ms on the emulator); the next letters may land in
 * between. An age that makes no sense (a different clock, a stale event)
 * falls back to now.
 */
export function pressedAtEpoch(eventTimestamp: number | undefined, monoNow: number, epochNow: number): number {
  if (eventTimestamp === undefined || !Number.isFinite(eventTimestamp)) return epochNow;
  const age = monoNow - eventTimestamp;
  return age >= 0 && age <= 5000 ? epochNow - age : epochNow;
}
