import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Machine credentials for the API.
 *
 * Shape: `tb_<43 base64url chars>` — 256 bits of CSPRNG output. The visible
 * head doubles as the lookup key so verification is one indexed read; the rest
 * is the secret and is never stored, only its SHA-256.
 *
 * SHA-256 rather than bcrypt/argon2 on purpose: those exist to slow down
 * guessing of low-entropy human passwords. Against 256 random bits, brute
 * force is already infeasible, and a slow KDF would only add latency to every
 * request.
 */

const TOKEN_PREFIX = "tb_";
/** Enough to be unique and recognisable in a list, short enough to stay opaque. */
const PREFIX_LENGTH = 11;

export const DEFAULT_EXPIRY_DAYS = 90;

export interface GeneratedToken {
  /** The full secret. Shown to the user once and never recoverable. */
  token: string;
  prefix: string;
  hash: string;
}

export function generateToken(): GeneratedToken {
  const secret = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX}${secret}`;
  return {
    token,
    prefix: token.slice(0, PREFIX_LENGTH),
    hash: hashToken(token),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Pulls the credential out of an Authorization header, if it carries one. */
export function bearerFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  return token;
}

/** The lookup key for a raw token, or null when it is too short to be one. */
export function prefixOf(raw: string): string | null {
  const prefix = raw.slice(0, PREFIX_LENGTH);
  return prefix.length === PREFIX_LENGTH ? prefix : null;
}

/** The stored columns this module needs to judge a token. */
export interface TokenRecord {
  id: string;
  name: string;
  token_hash: string;
  expires_at: Date | null;
  revoked_at: Date | null;
}

export interface VerifiedToken {
  id: string;
  name: string;
}

/**
 * Decides whether a presented token is usable. Pure, and separate from the
 * database read on purpose: the rules that matter — hash match, revocation,
 * expiry — are then testable without a Postgres.
 */
export function checkToken(
  record: TokenRecord | null,
  raw: string,
  now: Date
): VerifiedToken | null {
  if (!record) return null;
  if (!hashesMatch(record.token_hash, hashToken(raw))) return null;
  if (record.revoked_at !== null) return null;
  if (record.expires_at !== null && record.expires_at <= now) return null;
  return { id: record.id, name: record.name };
}

/** How an API token appears in the audit log, distinct from a human actor. */
export function tokenActor(name: string): string {
  return `token:${name}`;
}
