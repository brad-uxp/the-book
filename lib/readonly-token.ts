/**
 * The rules of a read-only token (ApiToken.kind `readonly`) that hold before
 * any database is read: what it looks like and which methods it may use.
 *
 * No imports: proxy.ts cuts a read-only token's writes with these before any
 * handler runs, and requireSession (lib/api.ts) refuses them again by the
 * request's own method, so either one alone keeps it from writing.
 */

/**
 * A read-only token's head, where every other token has `tb_`.
 *
 * Not `tb_ro_`: the rest of a `tb_` token is base64url, which can itself
 * start with `ro_`, so `tb_ro_` would not tell the kinds apart. `tbro_` is
 * never the head of a `tb_` token. A build older than this head does not
 * take it for a token at all: it answers 401, never treats it as another kind.
 * The database holds the head too: CHECK ApiToken_readonly_prefix refuses a
 * `readonly` row with any other one.
 */
export const READONLY_TOKEN_PREFIX = "tbro_";

/**
 * What a read-only token's stored hash is salted with (storedHashOf in
 * lib/api-tokens.ts): sha256(`ro1:<token>`), not sha256(<token>).
 *
 * The head keeps builds older than it from taking the token at all; this keeps
 * the builds that do take a `tbro_` head but gave it more than it reaches now —
 * 595f29c showed it the whole audit log — from accepting tokens minted here.
 * They hash the plain token, find no match and answer 401: after a rollback
 * the token stops working instead of reaching more.
 *
 * Bump it (`ro2`, …) whenever the read-only scope narrows again. Tokens minted
 * before stop working and are minted anew, and no build with the wider scope
 * accepts the new ones.
 */
export const READONLY_HASH_DOMAIN = "ro1";

/**
 * Read-only tokens minted before the domain — by 595f29c, 18d4253 or f99f898 —
 * keep their plain sha256. They still verify, so the finance CLI's token does
 * not break on deploy, but only if minted before this instant: a token minted
 * after it must carry the domain. Such a token keeps the old exposure (595f29c
 * accepts it) until it is revoked and minted anew; once none is left in use,
 * this fallback can go.
 */
export const READONLY_UNSALTED_BEFORE = new Date("2026-11-15T17:15:00Z");

/** What a read-only token hears on anything but a read, wherever it is refused. */
export const READONLY_REFUSAL =
  "A read-only token can only read (GET and HEAD requests); it cannot create, change or delete anything";

/**
 * The methods a read-only token may use. Exact, uppercase strings, as the
 * request carries them: anything else, including an unusual spelling, is not
 * a read.
 */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * The audit log entries a read-only token gets (GET /api/audit-logs): the
 * books' own entities, as lib/audit.ts names them in `entity_type`. Not
 * tokens, OAuth grants and consents, issues and canvases, app releases or
 * roles. A token's label in them keeps only its kind (tokenActorKindOnly).
 */
export const READONLY_AUDIT_ENTITY_TYPES: readonly string[] = [
  "invoice",
  "client",
  "subscription",
  "subscription_payment",
  "other_expense",
  "person",
  "salary_payment",
  "referrer",
  "fee_payment",
  "settings",
];

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method);
}

/**
 * Whether an Authorization header presents a read-only token. Looser than the
 * handlers' parse (any case, any whitespace) on purpose: the edge errs toward
 * refusing.
 */
export function presentsReadonlyToken(header: string | null | undefined): boolean {
  return /^\s*bearer\s+tbro_/i.test(header ?? "");
}
