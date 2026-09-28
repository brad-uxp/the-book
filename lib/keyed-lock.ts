/**
 * One at a time per key: a caller's calls under the same key run in order,
 * each after the previous one has finished; different keys run side by side.
 *
 * In process memory, which is enough with one replica (see lib/rate-limit.ts).
 * Used so one caller's sync pushes never run concurrently: each holds a
 * database connection for its whole run, and a burst of them from one token
 * would otherwise take the pool from everyone else.
 */

const tails = new Map<string, Promise<void>>();

export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => mine);
  tails.set(key, tail);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    // The last in line leaves nothing behind.
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** Test seam: how many keys have a call running or waiting. */
export function lockedKeyCount(): number {
  return tails.size;
}
