"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 60_000;

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}

/**
 * Bucketed to the minute so repeated calls within a tick return the identical
 * value — useSyncExternalStore requires a stable snapshot, and a raw Date.now()
 * would change on every read and loop forever.
 */
function getSnapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

/** On the server there is no clock to read; 0 makes every date "not yet due". */
function getServerSnapshot(): number {
  return 0;
}

/**
 * Current time, as an external store.
 *
 * Reading `Date.now()` during render makes a component non-idempotent: two
 * renders with identical props produce different output, and React is free to
 * re-render at any moment. Such relative-time UI is also silently stale — an
 * "overdue" badge only updates when something else happens to re-render.
 *
 * The clock is an external mutable source, which is exactly what
 * useSyncExternalStore models: stable within a render, and it ticks forward on
 * its own. Resolution is one minute, the finest any due-date badge here needs.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
