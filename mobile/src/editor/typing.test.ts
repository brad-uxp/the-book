import { test } from "node:test";
import assert from "node:assert/strict";
import { MARK_ACTIONS, TYPED_MEMORY_MS, lateTypedRange, pressedAtEpoch, recentLetters } from "./typing";

// "start one |" — the cursor at 11 when B is pressed at t=1000.
const before = [
  { at: 900, pos: 7 },
  { at: 920, pos: 8 },
  { at: 940, pos: 9 },
  { at: 960, pos: 10 },
];

test("letters typed after the press take the mark: B, then 'tw', the message crosses late", () => {
  const letters = [...before, { at: 1010, pos: 11 }, { at: 1030, pos: 12 }];
  assert.deepEqual(lateTypedRange(letters, 1000, 13), { from: 11, to: 13 });
});

test("B in the middle of a word: only the letters after the press take it", () => {
  // "hel" before the press, "lo" after it but before the message.
  const letters = [{ at: 900, pos: 1 }, { at: 920, pos: 2 }, { at: 940, pos: 3 }, { at: 1010, pos: 4 }, { at: 1030, pos: 5 }];
  assert.deepEqual(lateTypedRange(letters, 1000, 6), { from: 4, to: 6 });
});

test("nothing typed since the press, or no press time: nothing to cover", () => {
  assert.equal(lateTypedRange(before, 1000, 11), null);
  assert.equal(lateTypedRange([...before, { at: 1010, pos: 11 }], undefined, 12), null);
  assert.equal(lateTypedRange([], 1000, 11), null);
});

test("letters typed elsewhere since the press are not a stretch at the cursor", () => {
  assert.equal(lateTypedRange([{ at: 1010, pos: 40 }], 1000, 12), null);
  assert.equal(lateTypedRange([{ at: 1010, pos: 11 }, { at: 1020, pos: 30 }], 1000, 12), null);
});

test("only recent letters are kept", () => {
  const now = 10_000;
  const kept = recentLetters([{ at: now - TYPED_MEMORY_MS - 1, pos: 1 }, { at: now - 10, pos: 2 }], now);
  assert.deepEqual(kept, [{ at: now - 10, pos: 2 }]);
});

test("only bold, italic and highlight are marks; headings and lists are not", () => {
  assert.equal(MARK_ACTIONS.bold, "bold");
  assert.equal(MARK_ACTIONS.highlight, "highlight");
  assert.equal(MARK_ACTIONS.h2, undefined);
  assert.equal(MARK_ACTIONS.bulletList, undefined);
});

test("the press time is the touch's, not the handler's", () => {
  // Measured on the emulator: touch at 29277104, handler at 29277110.96.
  const at = pressedAtEpoch(29_277_104, 29_277_110.96, 1_790_572_369_430);
  assert.ok(Math.abs(at - (1_790_572_369_430 - 6.96)) < 0.001, String(at));
});

test("a timestamp from another clock or a stale one falls back to now", () => {
  assert.equal(pressedAtEpoch(undefined, 1000, 5000), 5000);
  assert.equal(pressedAtEpoch(2000, 1000, 5000), 5000); // from the future
  assert.equal(pressedAtEpoch(1_700_000_000_000, 1000, 5000), 5000); // an epoch value
  assert.equal(pressedAtEpoch(1000, 10_000, 5000), 5000); // older than 5 s
});
