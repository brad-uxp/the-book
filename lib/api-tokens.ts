import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  READONLY_HASH_DOMAIN,
  READONLY_REFUSAL,
  READONLY_TOKEN_PREFIX,
  READONLY_UNSALTED_BEFORE,
} from "@/lib/readonly-token";

export { READONLY_REFUSAL };

/**
 * Machine credentials for the API.
 *
 * Shape: `tb_<43 base64url chars>` — 256 bits of CSPRNG output; a read-only
 * token's head is `tbro_` instead (lib/readonly-token.ts). The visible
 * head doubles as the lookup key so verification is one indexed read; the rest
 * is the secret and is never stored, only its SHA-256 (for every kind with
 * less than the owner's reach, salted with that kind's domain: storedHashOf).
 *
 * SHA-256 rather than bcrypt/argon2 on purpose: those exist to slow down
 * guessing of low-entropy human passwords. Against 256 random bits, brute
 * force is already infeasible, and a slow KDF would only add latency to every
 * request.
 */

const TOKEN_PREFIX = "tb_";
/**
 * How much of the secret the lookup key keeps after the head: enough to be
 * unique and recognisable in a list, short enough to stay opaque. 11
 * characters in all for a `tb_` token, 13 for a `tbro_` one.
 */
const PREFIX_SECRET_CHARS = 8;

export const DEFAULT_EXPIRY_DAYS = 90;

/** The longest an `agent` token may last (Settings proposes 14 days for one). */
export const AGENT_TOKEN_MAX_DAYS = 30;

/** The longest a `readonly` token may last: it sits in a script's secrets, so it is rotated like one. */
export const READONLY_TOKEN_MAX_DAYS = 90;

export interface GeneratedToken {
  /** The full secret. Shown to the user once and never recoverable. */
  token: string;
  prefix: string;
  hash: string;
}

/**
 * A token for `kind`, hashed for that kind (storedHashOf): mint it with the
 * kind its row will have. A read-only one carries its own head, so the edge
 * can tell it apart.
 */
export function generateToken(kind: TokenKind = "automation"): GeneratedToken {
  const secret = randomBytes(32).toString("base64url");
  const token = `${kind === "readonly" ? READONLY_TOKEN_PREFIX : TOKEN_PREFIX}${secret}`;
  return {
    token,
    prefix: prefixOf(token)!,
    hash: storedHashOf(token, kind),
  };
}

/**
 * What the stored hash of each kind with less than the owner's reach is salted
 * with: sha256(`<domain>:<token>`) instead of sha256(<token>).
 *
 * A build that hashes the plain token finds no match and answers 401, so a
 * rollback cannot widen what such a token reaches. That matters most for the
 * builds before ApiToken.kind (up to 3fc4735): they give every token they
 * verify the owner's reach, so without a domain a release, agent or OAuth
 * access token would read and change the books there. readonly has its own
 * domain for the builds that gave it more (lib/readonly-token.ts).
 *
 * The owner-reach kinds (mobile, automation) keep the plain hash: a rollback
 * cannot give them more than they have, and a domain would make every phone
 * and script sign in again. A kind added later with less than the owner's
 * reach needs a domain here (lib/api-tokens.test.ts fails until it has one).
 * Bump a kind's domain (`ag2`, …) whenever its reach narrows: its tokens stop
 * working and are minted anew, and no build with the wider reach takes them.
 */
const HASH_DOMAINS: Readonly<Partial<Record<TokenKind, string>>> = {
  readonly: READONLY_HASH_DOMAIN,
  release: "rel1",
  agent: "ag1",
};

/**
 * Release and agent tokens minted before their domain — by every build up to
 * this one, OAuth access tokens included — keep their plain sha256. They still
 * verify, so the release script and a connected agent do not break on deploy,
 * but only if minted before this instant, which leaves the deploy a few days:
 * a row minted after it must carry the domain. Until such a token is revoked
 * and minted anew it keeps the old exposure (a build before ApiToken.kind
 * accepts it). If the deploy comes after this date, a token the old build
 * mints in between stops verifying (401) and is minted again; nothing widens.
 * Once none of them is left, this fallback can go.
 */
export const NARROW_UNSALTED_BEFORE = new Date("2026-11-22T00:00:00Z");

/** Per kind with a domain: before when one of its rows may still hold a plain hash. */
const UNSALTED_BEFORE: Readonly<Partial<Record<TokenKind, Date>>> = {
  readonly: READONLY_UNSALTED_BEFORE,
  release: NARROW_UNSALTED_BEFORE,
  agent: NARROW_UNSALTED_BEFORE,
};

/**
 * The hash ApiToken.token_hash keeps for a token of `kind`: SHA-256 of the
 * token, salted with the kind's domain when it has one (HASH_DOMAINS). The
 * kind comes from the row when verifying, and from the minting site when
 * minting, so a `tb_` token's hash still says what it is for.
 */
export function storedHashOf(token: string, kind: TokenKind): string {
  const domain = Object.hasOwn(HASH_DOMAINS, kind) ? HASH_DOMAINS[kind] : undefined;
  return domain === undefined ? hashToken(token) : hashToken(`${domain}:${token}`);
}

function headOf(raw: string): string | null {
  if (raw.startsWith(READONLY_TOKEN_PREFIX)) return READONLY_TOKEN_PREFIX;
  if (raw.startsWith(TOKEN_PREFIX)) return TOKEN_PREFIX;
  return null;
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
  if (!token || headOf(token) === null) return null;
  return token;
}

/** The lookup key for a raw token, or null when it is not long enough to be one. */
export function prefixOf(raw: string): string | null {
  const head = headOf(raw);
  if (head === null) return null;
  const length = head.length + PREFIX_SECRET_CHARS;
  return raw.length >= length ? raw.slice(0, length) : null;
}

/**
 * What a token is for (the ApiTokenKind enum): the phone's sign-in, a script,
 * the release script publishing app builds (and nothing else), an agent
 * working issues (and nothing else — lib/api.ts, lib/issues-service.ts), or a
 * script that only reads (GET and HEAD; every write is a 403 — lib/api.ts).
 */
export const TOKEN_KINDS = ["mobile", "automation", "release", "agent", "readonly"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

/** The stored columns this module needs to judge a token. */
export interface TokenRecord {
  id: string;
  name: string;
  kind: TokenKind;
  token_hash: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  /** When it was minted: a token of a salted kind minted before its cutoff (UNSALTED_BEFORE) may have a plain hash. */
  created_at?: Date;
  /** Where the token may be used: the MCP's URL for an OAuth access token, null for the REST API. */
  audience?: string | null;
  /** The OAuth connection an access token belongs to. */
  oauth_grant_id?: string | null;
}

export interface VerifiedToken {
  id: string;
  name: string;
  kind: TokenKind;
  audience: string | null;
  oauthGrantId: string | null;
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
  if (!hashesMatch(record.token_hash, storedHashOf(raw, record.kind)) && !unsaltedMatch(record, raw)) return null;
  // The head and the kind agree, or the token is no good: a read-only row
  // answers only to a `tbro_` token, which the edge confines to reads, and a
  // `tbro_` token only to a read-only row.
  if ((record.kind === "readonly") !== raw.startsWith(READONLY_TOKEN_PREFIX)) return null;
  if (record.revoked_at !== null) return null;
  if (record.expires_at !== null && record.expires_at <= now) return null;
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    audience: record.audience ?? null,
    oauthGrantId: record.oauth_grant_id ?? null,
  };
}

/**
 * A token of a salted kind minted before its domain existed, with its plain
 * hash: accepted only when the row says it was minted before that kind's
 * cutoff (UNSALTED_BEFORE), so no token minted from then on can have one. The
 * head still has to agree with the kind (checkToken, right after).
 */
function unsaltedMatch(record: TokenRecord, raw: string): boolean {
  const before = Object.hasOwn(UNSALTED_BEFORE, record.kind) ? UNSALTED_BEFORE[record.kind] : undefined;
  return (
    before !== undefined &&
    record.created_at instanceof Date &&
    record.created_at < before &&
    hashesMatch(record.token_hash, hashToken(raw))
  );
}

/**
 * How an API token appears in the audit log, distinct from a human actor:
 * `token:<kind>:<name> (<prefix>)`. The kind says what it was allowed to do —
 * an agent's writes stand out from a script's — and the prefix, which
 * Settings shows, tells apart two tokens given the same name.
 */
export function tokenActor(token: { name: string; kind: TokenKind; prefix: string }): string {
  return `token:${token.kind}:${token.name} (${token.prefix})`;
}

/**
 * A token's audit label with only its kind left — `token:<kind>:<name>
 * (<prefix>)` becomes `token:<kind>` — for a reader who may see that a token
 * acted but not which one (a read-only token reading the audit log).
 *
 * Only a kind this module knows is kept. Any other `token:…` label is just
 * `token`: before 2026-10-28 the label was `token:<name>`, with no kind, and
 * a name must not pass for one. Anything else — an email, "system", null —
 * comes back as it was.
 */
export function tokenActorKindOnly(label: string | null): string | null {
  if (typeof label !== "string" || !label.startsWith("token:")) return label;
  const kind = /^token:([a-z]+):/.exec(label)?.[1];
  return kind !== undefined && (TOKEN_KINDS as readonly string[]).includes(kind) ? `token:${kind}` : "token";
}
