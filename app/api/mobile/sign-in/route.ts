import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { readJson, toApiResponse } from "@/lib/api";
import { generateToken } from "@/lib/api-tokens";
import { ALLOWED_EMAILS } from "@/lib/allowed-emails";
import { checkGoogleClaims, verifyGoogleIdToken } from "@/lib/google-id-token";
import { consumeNonce } from "@/lib/mobile-nonce";
import { MOBILE_TOKEN_DAYS, SIGN_IN_LIMITS, clientIp, mobileTokenName, rateKeys } from "@/lib/mobile-auth";
import { checkRateLimit, peekRateLimit, recordRateLimitHit } from "@/lib/rate-limit";
import { MobileSignInSchema } from "@/lib/validations";

export const runtime = "nodejs";

/**
 * Signs the mobile app in: a Google ID token in, an API token out.
 *
 * Not /api/auth/mobile — that was an earlier mobile login, removed; this one
 * shares nothing with it. It is public by nature (the app has no credential
 * yet), so everything is checked here:
 *
 *  1. Rate limits per client IP, on all attempts and — separately — on failed
 *     ones, plus a global cap on failures.
 *  2. The token's signature against Google's keys, and issuer, audience (our
 *     web OAuth client), expiry, verified email and the allowlist.
 *  3. The nonce inside the token: issued by POST /api/mobile/nonce, unexpired
 *     and unused — so a Google ID token cannot be replayed.
 *
 * Only then is an API token minted, through the same lib/api-tokens.ts as the
 * ones made in Settings (the raw secret is returned once and never stored),
 * named after the device, and audited with the verified email as the actor.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const now = Date.now();

  const { perIp, failuresPerIp, failuresGlobal } = SIGN_IN_LIMITS;
  const tooMany = (retryAfter: number) =>
    NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );

  const attempt = checkRateLimit(rateKeys.signIn(ip), now, perIp.max, perIp.windowMs);
  if (!attempt.allowed) return tooMany(attempt.retryAfterSeconds);
  for (const [key, max] of [
    [rateKeys.failIp(ip), failuresPerIp.max],
    [rateKeys.failGlobal, failuresGlobal.max],
  ] as const) {
    const verdict = peekRateLimit(key, now, max);
    if (!verdict.allowed) return tooMany(verdict.retryAfterSeconds);
  }

  /** Every refusal counts against the failure budgets, then answers. */
  const refuse = (status: 400 | 401 | 403, error: string, reason: string) => {
    recordRateLimitHit(rateKeys.failIp(ip), now, failuresPerIp.windowMs);
    recordRateLimitHit(rateKeys.failGlobal, now, failuresGlobal.windowMs);
    console.warn(`[mobile/sign-in] refused (${reason}) from ${ip}`);
    return NextResponse.json({ error }, { status });
  };

  const parsed = MobileSignInSchema.safeParse(await readJson(req));
  if (!parsed.success) return refuse(400, "Invalid sign-in request", "body");

  const audience = process.env.AUTH_GOOGLE_ID;
  if (!audience) {
    console.error("[mobile/sign-in] AUTH_GOOGLE_ID is not set");
    return NextResponse.json({ error: "Sign-in is not available" }, { status: 503 });
  }

  let payload;
  try {
    payload = await verifyGoogleIdToken(parsed.data.id_token, audience);
  } catch {
    return refuse(401, "Sign-in failed", "signature_or_claims");
  }

  const claims = checkGoogleClaims(payload, {
    audience,
    allowedEmails: ALLOWED_EMAILS,
    now: new Date(now),
  });
  if (!claims.ok) {
    return claims.reason === "email_not_allowed"
      ? refuse(403, "This Google account can't use book.", claims.reason)
      : refuse(401, "Sign-in failed", claims.reason);
  }

  // Last, so a token that fails any other check never burns a real nonce.
  if (!consumeNonce(claims.nonce, now)) {
    return refuse(401, "Sign-in expired. Try again.", "nonce");
  }

  const { token, prefix, hash } = generateToken();
  const name = mobileTokenName(parsed.data.device_name);
  const expiresAt = new Date(now + MOBILE_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  try {
    const created = await prisma.apiToken.create({
      data: { name, token_prefix: prefix, token_hash: hash, expires_at: expiresAt },
      select: { id: true, name: true, token_prefix: true, expires_at: true },
    });

    auditLog({
      entity_type: "api_token",
      entity_id: created.id,
      entity_name: created.name,
      action: "create",
      actor_email: claims.email,
      after: {
        name: created.name,
        token_prefix: created.token_prefix,
        expires_at: created.expires_at,
        via: "mobile sign-in",
      },
    });

    // The only time the secret leaves the server.
    return NextResponse.json(
      {
        token,
        token_id: created.id,
        name: created.name,
        expires_at: created.expires_at,
        email: claims.email,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return toApiResponse(err);
  }
}
