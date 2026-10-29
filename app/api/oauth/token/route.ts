import { NextRequest, NextResponse } from "next/server";
import { readTextLimited } from "@/lib/api";
import { exchangeCode, refreshTokens, type TokenResult } from "@/lib/oauth-service";
import { checkRateLimit } from "@/lib/rate-limit";
import { OAuthCodeGrantSchema, OAuthRefreshGrantSchema } from "@/lib/validations";

export const runtime = "nodejs";

/** A token request is a few form fields. */
const TOKEN_BODY_MAX_BYTES = 8 * 1024;

/**
 * Generous for one owner — a connection refreshes once an hour — and still a
 * ceiling on what anyone can make this public endpoint do to the database.
 */
const TOKEN_REQUESTS_PER_MINUTE = 120;

/** Tokens and their errors are never cached (RFC 6749 §5.1). */
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: NO_STORE });
}

/**
 * The OAuth token endpoint: authorization_code and refresh_token, for a
 * public client (no secret; PKCE protects the code). Public — proxy.ts lets
 * it through — and the rules are lib/oauth-service.ts's. Form-encoded, as
 * RFC 6749 and Claude both have it.
 */
export async function POST(req: NextRequest) {
  const verdict = checkRateLimit("oauth-token", Date.now(), TOKEN_REQUESTS_PER_MINUTE);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "slow_down", error_description: "Too many token requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(verdict.retryAfterSeconds) } }
    );
  }

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Send the token request as application/x-www-form-urlencoded");
  }
  const body = await readTextLimited(req, TOKEN_BODY_MAX_BYTES);
  if (!body.ok) return oauthError("invalid_request", body.reason === "too_large" ? "Request too large" : "No body");
  const form = Object.fromEntries(new URLSearchParams(body.value));

  let result: TokenResult;
  if (form.grant_type === "authorization_code") {
    const parsed = OAuthCodeGrantSchema.safeParse(form);
    if (!parsed.success) return oauthError("invalid_request", "Missing or invalid fields for authorization_code");
    result = await exchangeCode(parsed.data);
  } else if (form.grant_type === "refresh_token") {
    const parsed = OAuthRefreshGrantSchema.safeParse(form);
    if (!parsed.success) return oauthError("invalid_request", "Missing or invalid fields for refresh_token");
    result = await refreshTokens(parsed.data);
  } else {
    return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token");
  }

  if (!result.ok) return oauthError(result.error, result.description);
  return NextResponse.json(result.tokens, { headers: NO_STORE });
}
