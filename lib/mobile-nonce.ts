import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Single-use nonces for mobile sign-in.
 *
 * The app asks for one, hands it to Google, and Google embeds it in the ID
 * token it signs. Sign-in accepts a token only if its nonce is one we issued,
 * unexpired and not used before — so a Google ID token lifted from somewhere
 * (a log, another app, an earlier sign-in) cannot be replayed to mint a new
 * API token.
 *
 * Stateless to issue: a nonce is `expiry ‖ 16 random bytes`, signed with an
 * HMAC keyed off AUTH_SECRET. Nothing is stored when one is handed out, so
 * issuing them cannot be flooded — there is no pool to fill and no honest
 * nonce to evict — and the issuing route needs no rate limit. What IS kept is
 * the set of nonces already used, and only a successful sign-in adds to it, so
 * its size is bounded by the owner's own sign-ins within the TTL.
 *
 * That set lives in process memory (one replica). A restart forgets it, which
 * reopens replay of a nonce used in the five minutes before the restart — and
 * only for someone already holding that sign-in's Google ID token. Accepted;
 * move the set to the database if a second replica is ever added.
 */

export const NONCE_TTL_MS = 5 * 60 * 1000;

const BODY_BYTES = 8 + 16; // expiry (u64, ms) + randomness
const MAC_BYTES = 32;

/** A key of its own, so a nonce MAC can never double as any other signature made with AUTH_SECRET. */
function nonceKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("book.mobile-nonce.v1").digest();
}

function mac(body: Buffer, secret: string): Buffer {
  return createHmac("sha256", nonceKey(secret)).update(body).digest();
}

export function issueNonce(
  secret: string,
  now: number = Date.now()
): { nonce: string; expiresAt: number } {
  const expiresAt = now + NONCE_TTL_MS;
  const body = Buffer.alloc(BODY_BYTES);
  body.writeBigUInt64BE(BigInt(expiresAt), 0);
  randomBytes(16).copy(body, 8);
  return {
    nonce: `${body.toString("base64url")}.${mac(body, secret).toString("base64url")}`,
    expiresAt,
  };
}

export type NonceCheck = "ok" | "malformed" | "forged" | "expired" | "replayed";

/** Nonce → its expiry, for nonces a successful sign-in has used. */
const used = new Map<string, number>();

function pruneUsed(now: number) {
  for (const [nonce, expiresAt] of used) {
    if (expiresAt <= now) used.delete(nonce);
  }
}

function parse(nonce: string): { body: Buffer; tag: Buffer } | null {
  const parts = nonce.split(".");
  if (parts.length !== 2) return null;
  const body = Buffer.from(parts[0], "base64url");
  const tag = Buffer.from(parts[1], "base64url");
  if (body.length !== BODY_BYTES || tag.length !== MAC_BYTES) return null;
  // Canonical encoding only: one string per nonce, so "used" cannot be dodged
  // by re-encoding the same bytes.
  if (body.toString("base64url") !== parts[0] || tag.toString("base64url") !== parts[1]) {
    return null;
  }
  return { body, tag };
}

/** Whether a nonce would be accepted right now. Does not use it up. */
export function checkNonce(
  nonce: string | null | undefined,
  secret: string,
  now: number = Date.now()
): NonceCheck {
  if (!nonce || nonce.length > 128) return "malformed";
  const parsed = parse(nonce);
  if (!parsed) return "malformed";
  if (!timingSafeEqual(parsed.tag, mac(parsed.body, secret))) return "forged";
  if (Number(parsed.body.readBigUInt64BE(0)) <= now) return "expired";
  if (used.has(nonce)) return "replayed";
  return "ok";
}

/**
 * True exactly once per genuine, unexpired nonce. Check and record happen in
 * one synchronous step, so two concurrent sign-ins with the same nonce cannot
 * both pass.
 */
export function consumeNonce(
  nonce: string | null | undefined,
  secret: string,
  now: number = Date.now()
): boolean {
  if (checkNonce(nonce, secret, now) !== "ok") return false;
  pruneUsed(now);
  const parsed = parse(nonce as string) as { body: Buffer };
  used.set(nonce as string, Number(parsed.body.readBigUInt64BE(0)));
  return true;
}

/** Test seam. */
export function resetUsedNonces(): void {
  used.clear();
}
