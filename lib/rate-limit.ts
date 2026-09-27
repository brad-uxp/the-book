/**
 * Fixed-window rate limiter, in process memory.
 *
 * In memory is the right size here: the service runs a single replica, so one
 * process sees every request. If a second replica is ever added this becomes
 * per-replica and the effective limit multiplies — move it to the database or
 * Redis at that point.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 300;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  max: number = MAX_REQUESTS,
  windowMs: number = WINDOW_MS
): RateVerdict {
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: max - existing.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Whether a key is still under its limit, without counting this call.
 *
 * For limits on failures: the check happens before the attempt, and only a
 * failed attempt is recorded afterwards (recordRateLimitHit), so a successful
 * sign-in never uses up the failure budget.
 */
export function peekRateLimit(
  key: string,
  now: number = Date.now(),
  max: number = MAX_REQUESTS
): RateVerdict {
  const existing = windows.get(key);
  if (!existing || now >= existing.resetAt || existing.count < max) {
    const used = existing && now < existing.resetAt ? existing.count : 0;
    return { allowed: true, remaining: max - used, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Counts one hit against a key, opening a window if there is none. */
export function recordRateLimitHit(
  key: string,
  now: number = Date.now(),
  windowMs: number = WINDOW_MS
): void {
  const existing = windows.get(key);
  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  existing.count += 1;
}

/**
 * Drops windows that have already expired. Without this the map grows by one
 * entry per key forever — bounded in practice by how many tokens exist, but
 * there is no reason to leak.
 */
export function pruneRateLimits(now: number = Date.now()): void {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
}

/** Test seam. */
export function resetRateLimits(): void {
  windows.clear();
}
