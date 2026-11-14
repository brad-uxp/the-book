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
 * never the head of a `tb_` token. A build that predates this kind does not
 * take it for a token at all: it answers 401, never treats it as another kind.
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
