import { NextResponse } from "next/server";
import { auth, isAllowedSession } from "@/auth";

/**
 * Per-handler authorization.
 *
 * `proxy.ts` already gates every route, but that is a single point of failure:
 * one bad matcher entry or one Auth.js config error and the whole API is open.
 * Handlers call this so authorization is enforced where the data actually
 * lives, not only at the edge.
 *
 * Returns a 401 response to hand straight back, or null when allowed:
 *
 *   const denied = await requireSession();
 *   if (denied) return denied;
 */
export async function requireSession(): Promise<NextResponse | null> {
  const session = await auth().catch(() => null);
  if (isAllowedSession(session)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
