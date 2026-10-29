import { cache } from "react";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth, isAllowedSession } from "@/auth";
import { prisma } from "@/lib/db";
import {
  bearerFromHeader,
  checkToken,
  prefixOf,
  tokenActor,
  type TokenKind,
} from "@/lib/api-tokens";
import { mcpResource, mcpUnauthorized } from "@/lib/mcp-auth";
import { canonicalResource } from "@/lib/oauth";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Writer } from "@/lib/issues-service";

/** Who is making the current request. */
export type Actor =
  | { kind: "user"; label: string }
  | {
      kind: "token";
      id: string;
      name: string;
      label: string;
      tokenKind: TokenKind;
      /** Set for an OAuth access token: the MCP's URL, the only place it is good for. */
      audience?: string | null;
    };

/**
 * Resolves the caller from either credential the API accepts: a NextAuth
 * cookie (the browser) or a Bearer token (machines).
 *
 * Wrapped in `cache` so a request that authorizes and then writes an audit log
 * resolves the caller once rather than hitting the tokens table twice.
 *
 * Note this runs in the Node handler, not in `proxy.ts` — the proxy is Edge and
 * cannot reach Prisma, so it lets Bearer requests through and lets the handler
 * decide.
 */
export const resolveActor = cache(async (): Promise<Actor | null> => {
  const raw = bearerFromHeader((await headers()).get("authorization"));

  if (raw) {
    const prefix = prefixOf(raw);
    if (!prefix) return null;
    const record = await prisma.apiToken
      .findUnique({ where: { token_prefix: prefix } })
      .catch(() => null);
    const verified = checkToken(record, raw, new Date());
    if (!verified) return null;

    // Recorded for the settings page; must never fail the request.
    prisma.apiToken
      .update({ where: { id: verified.id }, data: { last_used_at: new Date() } })
      .catch((err) => console.error("[api-token] last_used_at:", err));

    return {
      kind: "token",
      id: verified.id,
      name: verified.name,
      label: tokenActor({ name: verified.name, kind: verified.kind, prefix }),
      tokenKind: verified.kind,
      audience: verified.audience,
    };
  }

  const session = await auth().catch(() => null);
  if (!isAllowedSession(session)) return null;
  const email = (session as { user?: { email?: string } } | null)?.user?.email;
  return { kind: "user", label: email ?? "unknown" };
});

/**
 * Per-handler authorization.
 *
 * `proxy.ts` already gates every route, but that is a single point of failure:
 * one bad matcher entry or one Auth.js config error and the whole API is open.
 * Handlers call this so authorization is enforced where the data actually
 * lives, not only at the edge.
 *
 * Returns a response to hand straight back, or null when allowed:
 *
 *   const denied = await requireSession();
 *   if (denied) return denied;
 *
 * An agent token is refused unless the route passes `{ agent: true }` — only
 * the issue routes do, and there lib/issues-service.ts decides what it may
 * write. Refusing by default means a new route never opens the books to it
 * by forgetting to.
 */
export async function requireSession(opts: { agent?: boolean } = {}): Promise<NextResponse | null> {
  const actor = await resolveActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // An OAuth access token is for the MCP (requireAgentToken): its audience.
  // Here it is a token for somewhere else.
  if (actor.kind === "token" && actor.audience) {
    return NextResponse.json(
      { error: "This token is for theBook's MCP only" },
      { status: 403 }
    );
  }

  // A release token only publishes app builds (requireReleaseToken). It lives
  // in the release script's Keychain entry; if it leaked it must not open the
  // books, so every other route refuses it here.
  if (actor.kind === "token" && actor.tokenKind === "release") {
    return NextResponse.json(
      { error: "A release token can only publish app builds" },
      { status: 403 }
    );
  }

  // An agent token works issues and nothing else: no finances, no settings,
  // no tokens. It lives in an agent's config, where a prompt it reads can
  // try to steer it.
  if (actor.kind === "token" && actor.tokenKind === "agent" && !opts.agent) {
    return NextResponse.json(
      { error: "An agent token can only reach issues" },
      { status: 403 }
    );
  }

  // Only machine callers are limited. A runaway agent loop is the realistic
  // way this API gets hammered; a human in a browser is not.
  if (actor.kind === "token") {
    const verdict = checkRateLimit(actor.id);
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: { "Retry-After": String(verdict.retryAfterSeconds) },
        }
      );
    }
  }

  return null;
}

/**
 * The caller as lib/issues-service.ts needs it: a label for the log, and what
 * it may change. Only an agent token is held to an agent's fields; with no
 * caller at all (which requireSession has already refused) it gets no more.
 */
export async function getWriter(): Promise<Writer> {
  const actor = await resolveActor().catch(() => null);
  const owner = actor !== null && !(actor.kind === "token" && actor.tokenKind === "agent");
  return { actor: actor?.label ?? null, access: owner ? "owner" : "agent" };
}

/**
 * Authorization for routes a machine must never reach.
 *
 * Token management is the obvious one: a token that can mint tokens is a token
 * that cannot be revoked, since the agent would simply issue itself a new one.
 * Revoking has to stay something only the human can do.
 */
export async function requireUserSession(): Promise<NextResponse | null> {
  const actor = await resolveActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.kind !== "user") {
    return NextResponse.json(
      { error: "This endpoint requires an interactive session" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Authorization for the phone's sync (/api/sync/*): the browser's user, or a
 * token the app's sign-in minted. Not a hand-made automation token: it
 * reaches the same notes through the issue routes already, and those tokens
 * — pasted into scripts and agents — are the ones most likely to leak; the
 * sync is the costliest endpoint to leave open to them.
 */
export async function requireSyncSession(): Promise<NextResponse | null> {
  return requireAppSession("Sync is only for the book. app; use the issue routes with this token");
}

/**
 * The browser's user or the phone's own token — for routes that exist for the
 * app (the sync, its update check). Automation and release tokens get `refusal`.
 */
export async function requireAppSession(
  refusal = "This endpoint is only for the book. app"
): Promise<NextResponse | null> {
  const denied = await requireSession();
  if (denied) return denied;
  const actor = await resolveActor();
  if (actor?.kind === "token" && actor.tokenKind !== "mobile") {
    return NextResponse.json({ error: refusal }, { status: 403 });
  }
  return null;
}

/**
 * Authorization for publishing app builds: a release token and nothing else —
 * not the browser session, not the phone's token. Publishing is done by the
 * release script, which reads this token from the Mac's Keychain.
 */
export async function requireReleaseToken(): Promise<NextResponse | null> {
  const actor = await resolveActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actor.kind !== "token" || actor.tokenKind !== "release") {
    return NextResponse.json(
      { error: "Publishing app builds needs a release token" },
      { status: 403 }
    );
  }
  const verdict = checkRateLimit(actor.id);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } }
    );
  }
  return null;
}

/**
 * Authorization for the MCP (/api/mcp): an access token theBook's OAuth
 * issued for it (lib/oauth-service.ts) — kind `agent`, audience the MCP's
 * URL — and nothing else. The MCP is the agents' way in and holds every
 * caller to an agent's rules (lib/issues-service.ts); the owner and the
 * scripts have the REST API. Anything else — no Bearer, a browser session,
 * an expired or revoked token, a token for somewhere else — is the 401 whose
 * challenge starts a client's OAuth (lib/mcp-auth.ts).
 */
export async function requireAgentToken(): Promise<Response | null> {
  const presented = (await headers()).has("authorization");
  const actor = await resolveActor();
  if (
    !actor ||
    actor.kind !== "token" ||
    actor.tokenKind !== "agent" ||
    !actor.audience ||
    canonicalResource(actor.audience) !== canonicalResource(mcpResource())
  ) {
    return mcpUnauthorized(presented);
  }
  const verdict = checkRateLimit(actor.id);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } }
    );
  }
  return null;
}

/** Prisma's known request errors carry a string `code` like "P2025". */
function prismaCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : null;
}

/**
 * Maps a thrown error to a response. Without this every Prisma failure —
 * deleting a row that is already gone, violating a unique index — surfaces as
 * an opaque 500 that is indistinguishable from a genuine bug.
 */
export function toApiResponse(err: unknown): NextResponse {
  switch (prismaCode(err)) {
    case "P2025":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "P2002":
      return NextResponse.json(
        { error: "A record with these values already exists" },
        { status: 409 }
      );
    case "P2003":
      return NextResponse.json(
        { error: "Referenced record does not exist" },
        { status: 400 }
      );
    default:
      // Log server-side; never leak the message or stack to the client.
      console.error("[api] unhandled error:", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Parse a JSON body without turning a malformed payload into a 500.
 * Returns `undefined` when the body is absent or not valid JSON.
 */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/**
 * Parse a JSON body read with a hard size cap, for routes anyone can reach.
 *
 * readJson buffers the whole body before a schema can refuse it; on a public
 * route that lets a client make the server hold whatever it sends. This stops
 * reading at `maxBytes` — whether or not the client declared a length, and
 * whether or not it told the truth.
 */
export async function readJsonLimited(
  req: Request,
  maxBytes: number
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid" }> {
  const text = await readTextLimited(req, maxBytes);
  if (!text.ok) return text;
  try {
    return { ok: true, value: JSON.parse(text.value) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** The body as text, read with the same hard cap as readJsonLimited. */
export async function readTextLimited(
  req: Request,
  maxBytes: number
): Promise<{ ok: true; value: string } | { ok: false; reason: "too_large" | "invalid" }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (!req.body) return { ok: false, reason: "invalid" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(bytes) };
}

/** Standard 400 for a failed Zod parse, matching the project convention. */
export function invalid(error: { flatten: () => unknown }): NextResponse {
  return NextResponse.json({ error: error.flatten() }, { status: 400 });
}
