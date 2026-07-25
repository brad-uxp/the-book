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
} from "@/lib/api-tokens";
import { checkRateLimit } from "@/lib/rate-limit";

/** Who is making the current request. */
export type Actor =
  | { kind: "user"; label: string }
  | { kind: "token"; id: string; label: string };

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

    return { kind: "token", id: verified.id, label: tokenActor(verified.name) };
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
 */
export async function requireSession(): Promise<NextResponse | null> {
  const actor = await resolveActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

/** Standard 400 for a failed Zod parse, matching the project convention. */
export function invalid(error: { flatten: () => unknown }): NextResponse {
  return NextResponse.json({ error: error.flatten() }, { status: 400 });
}
