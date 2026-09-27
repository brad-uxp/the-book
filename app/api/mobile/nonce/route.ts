import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { issueNonce } from "@/lib/mobile-nonce";
import { SIGN_IN_LIMITS, clientIp, rateKeys } from "@/lib/mobile-auth";

export const runtime = "nodejs";

/**
 * A single-use nonce for the next sign-in. Public — the app has no credential
 * yet — and rate-limited per IP. Issuing one grants nothing: it only makes a
 * Google ID token minted for it usable once, within five minutes.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const { max, windowMs } = SIGN_IN_LIMITS.noncesPerIp;
  const verdict = checkRateLimit(rateKeys.nonce(ip), Date.now(), max, windowMs);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } }
    );
  }

  const { nonce, expiresAt } = issueNonce();
  return NextResponse.json(
    { nonce, expires_at: new Date(expiresAt).toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
