import { randomBytes } from "node:crypto";

/**
 * Single-use nonces for mobile sign-in.
 *
 * The app asks for one, hands it to Google, and Google embeds it in the ID
 * token it signs. Sign-in accepts a token only if its nonce is one we issued,
 * unexpired and not used before — so a Google ID token lifted from somewhere
 * (a log, another app, an earlier sign-in) cannot be replayed to mint a new
 * API token.
 *
 * In process memory, like the rate limiter, because the service runs a single
 * replica. A deploy drops pending nonces; the app simply asks for a new one.
 */

export const NONCE_TTL_MS = 5 * 60 * 1000;

/** Enough for any honest use; stops a nonce flood from growing the map. */
export const MAX_PENDING_NONCES = 500;

const pending = new Map<string, number>();

function prune(now: number) {
  for (const [nonce, expiresAt] of pending) {
    if (expiresAt <= now) pending.delete(nonce);
  }
}

export function issueNonce(now: number = Date.now()): { nonce: string; expiresAt: number } {
  prune(now);
  // Oldest first: a Map iterates in insertion order.
  while (pending.size >= MAX_PENDING_NONCES) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = now + NONCE_TTL_MS;
  pending.set(nonce, expiresAt);
  return { nonce, expiresAt };
}

/** True exactly once per issued, unexpired nonce. */
export function consumeNonce(nonce: string | null | undefined, now: number = Date.now()): boolean {
  if (!nonce) return false;
  const expiresAt = pending.get(nonce);
  if (expiresAt === undefined) return false;
  pending.delete(nonce);
  return expiresAt > now;
}

/** Test seam. */
export function resetNonces(): void {
  pending.clear();
}
