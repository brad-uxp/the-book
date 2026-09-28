import { test } from "node:test";
import assert from "node:assert/strict";
import { syncSummary } from "./status.ts";

const NOW = new Date("2026-09-28T12:00:00Z");
const ok = { online: true, syncing: false, lastSyncedAt: NOW.getTime() - 120_000, error: null };

test("el estado de la sync, en palabras", () => {
  assert.equal(syncSummary(ok, 0, NOW), "Synced 2 min ago.");
  assert.equal(syncSummary({ ...ok, lastSyncedAt: NOW.getTime() - 3 * 3600_000 }, 0, NOW), "Synced 3 h ago.");
  assert.equal(syncSummary({ ...ok, lastSyncedAt: NOW.getTime() - 5000 }, 0, NOW), "Synced just now.");
  assert.equal(syncSummary({ ...ok, online: false }, 3, NOW), "Offline. Your notes are on this phone and sync when you're back online. 3 changes waiting to sync.");
  assert.equal(syncSummary({ ...ok, syncing: true }, 1, NOW), "Syncing… 1 change waiting to sync.");
  assert.equal(syncSummary({ ...ok, lastSyncedAt: null }, 0, NOW), "Not synced yet.");
  assert.match(syncSummary({ ...ok, error: "Can't reach book." }, 0, NOW), /^Couldn't sync/);
});
