/**
 * Fixed-window rate limiter, in process memory.
 *
 * In memory is the right size here: the service runs a single replica, so one
 * process sees every request. If a second replica is ever added this becomes
 * per-replica and the effective limit multiplies — move it to the database or
 * Redis at that point. The same holds for the per-caller lock on sync pushes
 * (lib/keyed-lock.ts): one process, one queue per caller.
 *
 * A request may cost more than one unit (`cost`): a sync push is charged per
 * change it carries, since that — not the request — is the work.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 300;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * Past this many keys, a check first drops expired windows. Keys are API-token
 * ids today, so the map stays small; the bound is there so no future caller
 * can turn it into a leak.
 */
const PRUNE_ABOVE = 1000;

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  max: number = MAX_REQUESTS,
  windowMs: number = WINDOW_MS,
  cost: number = 1
): RateVerdict {
  if (windows.size > PRUNE_ABOVE) pruneRateLimits(now);
  let window = windows.get(key);

  if (!window || now >= window.resetAt) {
    window = { count: 0, resetAt: now + windowMs };
    windows.set(key, window);
  }

  // Refused requests are not charged: a caller over its budget waits out the
  // window, not a window that its own retries keep extending.
  if (window.count + cost > max) {
    return {
      allowed: false,
      remaining: Math.max(0, max - window.count),
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }

  window.count += cost;
  return {
    allowed: true,
    remaining: max - window.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Drops windows that have already expired. Called by checkRateLimit once the
 * map passes PRUNE_ABOVE keys.
 */
export function pruneRateLimits(now: number = Date.now()): void {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
}

/** Test seams. */
export function resetRateLimits(): void {
  windows.clear();
}

export function rateLimitKeyCount(): number {
  return windows.size;
}
