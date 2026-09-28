import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel, dueLabel, fetchedLabel, monthShort, monthTitle, montevideoToday, ordinal, relativeTime, shiftMonth } from "./format.ts";

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

test("meses: correr, titular y abreviar", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-09", -11), "2025-10");
  assert.equal(monthTitle("2026-09"), "September 2026");
  assert.equal(monthShort("2026-02"), "Feb 2026");
});

test("un día guardado a medianoche UTC se muestra como ese día, con año si no es este", () => {
  assert.equal(dayLabel("2026-09-30T00:00:00.000Z", NOW), "Sep 30");
  assert.equal(dayLabel("2025-12-31", NOW), "Dec 31, 2025");
});

test("ordinales en inglés", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 25, 31].map(ordinal), [
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "25th", "31st",
  ]);
});

test("cuándo se actualizó una pantalla", () => {
  assert.equal(fetchedLabel("2026-09-28T01:29:50Z", NOW), "Updated just now");
  assert.equal(fetchedLabel("2026-09-28T01:25:00Z", NOW), "Updated 5m ago");
  assert.equal(fetchedLabel("2026-09-10T12:00:00Z", NOW), "Updated Sep 10");
});

