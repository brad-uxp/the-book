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
 * That is what protects a read-only token after a rollback, so the database
 * holds it too: CHECK ApiToken_readonly_prefix refuses a `readonly` row with
 * any other head.
 */
export const READONLY_TOKEN_PREFIX = "tbro_";

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
 * tokens, OAuth grants and consents, issues and canvases, app releases, roles
 * or salary increase reminders.
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
