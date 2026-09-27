import { NextResponse } from "next/server";
import { issueNonce } from "@/lib/mobile-nonce";

export const runtime = "nodejs";

/**
 * A single-use nonce for the next sign-in. Public — the app has no credential
 * yet. Issuing one grants nothing and stores nothing: it is signed, not
 * remembered (see lib/mobile-nonce.ts), so this route has no state to flood
 * and needs no rate limit.
 */
export async function POST() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error("[mobile/nonce] AUTH_SECRET is not set");
    return NextResponse.json({ error: "Sign-in is not available" }, { status: 503 });
  }

  const { nonce, expiresAt } = issueNonce(secret);
  return NextResponse.json(
    { nonce, expires_at: new Date(expiresAt).toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
