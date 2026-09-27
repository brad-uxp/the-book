import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { readJsonLimited, toApiResponse } from "@/lib/api";
import { generateToken } from "@/lib/api-tokens";
import { MOBILE_ALLOWED_EMAILS } from "@/lib/allowed-emails";
import { checkGoogleClaims, verifyGoogleIdToken } from "@/lib/google-id-token";
import { consumeNonce } from "@/lib/mobile-nonce";
import {
  MOBILE_BODY_MAX_BYTES,
  MOBILE_TOKEN_DAYS,
  forwardedForLog,
  mobileAuthorizedParties,
  mobileTokenName,
} from "@/lib/mobile-auth";
import { MobileSignInSchema } from "@/lib/validations";

export const runtime = "nodejs";

/**
 * Signs the mobile app in: a Google ID token in, an API token out.
 *
 * Not /api/auth/mobile — that was an earlier mobile login, removed; this one
 * shares nothing with it. It is public by nature (the app has no credential
 * yet), so everything is checked here:
 *
 *  1. The body, read with a hard size cap.
 *  2. The token's signature against Google's keys, and issuer, audience (our
 *     web OAuth client), authorized party (our release Android client — any
 *     other client of the same Cloud project is refused), expiry, verified
 *     email and the mobile allowlist (the personal Gmail only — see
 *     lib/allowed-emails.ts).
 *  3. The nonce inside the token: signed by POST /api/mobile/nonce, unexpired
 *     and unused — so a Google ID token cannot be replayed.
 *
 * Only then is an API token minted, through the same lib/api-tokens.ts as the
 * ones made in Settings (the raw secret is returned once and never stored),
 * named after the device, and audited with the verified email as the actor.
 *
 * No per-IP rate limit, deliberately — see lib/mobile-auth.ts for why a limit
 * here could only ever lock the owner out.
 */
export async function POST(req: NextRequest) {
  const now = Date.now();

  const audience = process.env.AUTH_GOOGLE_ID;
  const secret = process.env.AUTH_SECRET;
  const parties = mobileAuthorizedParties(process.env);
  if (!audience || !secret || parties.length === 0) {
    // Fail closed: without every one of these, no token can be judged.
    console.error(
      "[mobile/sign-in] not configured:",
      [!audience && "AUTH_GOOGLE_ID", !secret && "AUTH_SECRET", parties.length === 0 && "MOBILE_ANDROID_CLIENT_ID"]
        .filter(Boolean)
        .join(", ")
    );
    return NextResponse.json({ error: "Sign-in is not available" }, { status: 503 });
  }

  const refuse = (status: 400 | 401 | 403 | 413, error: string, reason: string) => {
    console.warn(`[mobile/sign-in] refused (${reason}) xff=${forwardedForLog(req.headers)}`);
    return NextResponse.json({ error }, { status });
  };

  const raw = await readJsonLimited(req, MOBILE_BODY_MAX_BYTES);
  if (!raw.ok) {
    return raw.reason === "too_large"
      ? refuse(413, "Sign-in request too large", "body_too_large")
      : refuse(400, "Invalid sign-in request", "body");
  }
  const parsed = MobileSignInSchema.safeParse(raw.value);
  if (!parsed.success) return refuse(400, "Invalid sign-in request", "body");

  let payload;
  try {
    payload = await verifyGoogleIdToken(parsed.data.id_token, audience);
  } catch {
    return refuse(401, "Sign-in failed", "signature_or_claims");
  }

  const claims = checkGoogleClaims(payload, {
    audience,
    authorizedParties: parties,
    allowedEmails: MOBILE_ALLOWED_EMAILS,
    now: new Date(now),
  });
  if (!claims.ok) {
    return claims.reason === "email_not_allowed"
      ? refuse(403, "This Google account can't use book.", claims.reason)
      : refuse(401, "Sign-in failed", claims.reason);
  }

  // Last, so a token that fails any other check never uses up a nonce.
  if (!consumeNonce(claims.nonce, secret, now)) {
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
