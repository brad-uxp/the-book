import { test } from "node:test";
import assert from "node:assert/strict";
import { dueLabel, montevideoToday, relativeTime } from "./format.ts";

// 2026-09-28 01:30 UTC is still the 27th in Montevideo (UTC−3).
const NOW = new Date("2026-09-28T01:30:00Z");

test("hoy en Montevideo, no en UTC", () => {
  assert.equal(montevideoToday(NOW), "2026-09-27");
  assert.equal(montevideoToday(new Date("2026-09-28T03:00:00Z")), "2026-09-28");
});

test("vencimientos: vencida, hoy, mañana, pronto y normal", () => {
  assert.deepEqual(dueLabel("2026-09-25T00:00:00.000Z", NOW), { text: "Overdue · Sep 25", tone: "overdue" });
  assert.deepEqual(dueLabel("2026-09-27T00:00:00.000Z", NOW), { text: "Today", tone: "soon" });
  assert.deepEqual(dueLabel("2026-09-28T00:00:00.000Z", NOW), { text: "Tomorrow", tone: "soon" });
  assert.deepEqual(dueLabel("2026-09-29T00:00:00.000Z", NOW), { text: "Sep 29", tone: "soon" });
  assert.deepEqual(dueLabel("2026-09-30T00:00:00.000Z", NOW), { text: "Sep 30", tone: "normal" });
});

test("otro año lleva el año", () => {
  assert.deepEqual(dueLabel("2027-01-15T00:00:00.000Z", NOW), { text: "Jan 15, 2027", tone: "normal" });
  assert.equal(dueLabel("2025-12-31T00:00:00.000Z", NOW).text, "Overdue · Dec 31, 2025");
});

test("tiempo relativo", () => {
  assert.equal(relativeTime("2026-09-28T01:29:30Z", NOW), "now");
  assert.equal(relativeTime("2026-09-28T01:25:00Z", NOW), "5m");
  assert.equal(relativeTime("2026-09-27T23:30:00Z", NOW), "2h");
  assert.equal(relativeTime("2026-09-25T01:30:00Z", NOW), "3d");
  assert.equal(relativeTime("2026-09-10T15:00:00Z", NOW), "Sep 10");
  // Un reloj del teléfono atrasado no da tiempos negativos.
  assert.equal(relativeTime("2026-09-28T02:00:00Z", NOW), "now");
});
