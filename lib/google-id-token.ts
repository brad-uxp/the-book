import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

/**
 * Verifying a Google ID token presented by the mobile app.
 *
 * Two layers, on purpose:
 *
 *  - verifyGoogleIdToken() checks the signature against Google's published
 *    keys (JWKS), and lets jose check issuer, audience and expiry while it is
 *    at it. That needs the network.
 *  - checkGoogleClaims() re-checks every claim the decision rests on — and the
 *    ones jose does not know about (email, email_verified, the allowlist, the
 *    nonce's presence) — as a pure function, so each rule has a test that runs
 *    without Google.
 *
 * The audience is the WEB OAuth client (AUTH_GOOGLE_ID): the Android app asks
 * Credential Manager for a token "for" the server, so aud is the web client and
 * azp is the Android client. A token minted for any other audience — another
 * app's, even one of ours — is refused. And because any client in the same
 * Cloud project can obtain a token with that audience, azp must also be one of
 * our Android clients (see mobileAuthorizedParties in lib/mobile-auth.ts).
 */

export const GOOGLE_ISSUERS = [
  "accounts.google.com",
  "https://accounts.google.com",
] as const;

const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

/** Seconds of clock drift tolerated between Google, the phone and us. */
export const CLOCK_TOLERANCE_S = 30;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Google's signing keys, fetched once and cached. jose refetches when Google
 * rotates them (an unknown kid), with a cooldown so a flood of bad tokens
 * cannot turn into a flood of fetches.
 */
function googleKeys(): JWTVerifyGetKey {
  jwks ??= createRemoteJWKSet(GOOGLE_JWKS_URL, {
    cooldownDuration: 30_000,
    cacheMaxAge: 6 * 60 * 60 * 1000,
  });
  return jwks;
}

/**
 * Signature, issuer, audience and expiry, against Google's current keys (or
 * the key set a test passes). Throws on any failure; the caller treats every
 * throw the same way.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audience: string,
  keys: JWTVerifyGetKey = googleKeys()
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: [...GOOGLE_ISSUERS],
    audience,
    algorithms: ["RS256"],
    clockTolerance: CLOCK_TOLERANCE_S,
  });
  return payload;
}

export type ClaimFailure =
  | "issuer"
  | "audience"
  | "authorized_party"
  | "expired"
  | "issued_in_future"
  | "subject"
  | "email_missing"
  | "email_unverified"
  | "email_not_allowed"
  | "nonce_missing";

export type ClaimCheck =
  | { ok: true; email: string; subject: string; nonce: string }
  | { ok: false; reason: ClaimFailure };

export interface ClaimOptions {
  audience: string;
  /** The Android clients allowed as `azp`. Empty refuses every token. */
  authorizedParties: readonly string[];
  allowedEmails: readonly string[];
  now: Date;
}

/**
 * Everything the sign-in decision rests on, re-checked from the payload.
 * Order matters only for which reason is reported; any failure refuses.
 */
export function checkGoogleClaims(
  payload: JWTPayload & Record<string, unknown>,
  { audience, authorizedParties, allowedEmails, now }: ClaimOptions
): ClaimCheck {
  if (!(GOOGLE_ISSUERS as readonly string[]).includes(String(payload.iss))) {
    return { ok: false, reason: "issuer" };
  }

  // Google issues a single audience. An array is accepted only if it is
  // exactly ours — never "ours among others".
  const aud = payload.aud;
  const audOk = Array.isArray(aud)
    ? aud.length === 1 && aud[0] === audience
    : aud === audience;
  if (!audOk) return { ok: false, reason: "audience" };

  // Which client asked for the token. aud says it is for us; azp says it was
  // our app that asked — not another client of the same Cloud project, and
  // not a web flow through one of the web client's redirect URIs.
  if (typeof payload.azp !== "string" || !authorizedParties.includes(payload.azp)) {
    return { ok: false, reason: "authorized_party" };
  }

  const nowS = Math.floor(now.getTime() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_TOLERANCE_S <= nowS) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.iat === "number" && payload.iat - CLOCK_TOLERANCE_S > nowS) {
    return { ok: false, reason: "issued_in_future" };
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "subject" };
  }

  const email = payload.email;
  if (typeof email !== "string" || email.length === 0) {
    return { ok: false, reason: "email_missing" };
  }
  // Google has sent this as a boolean and, historically, as the string "true".
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    return { ok: false, reason: "email_unverified" };
  }
  if (!allowedEmails.includes(email)) {
    return { ok: false, reason: "email_not_allowed" };
  }

  // The app always asks Google to embed a nonce we issued. A token without one
  // was not minted for this sign-in, whatever else it says.
  const nonce = payload.nonce;
  if (typeof nonce !== "string" || nonce.length === 0) {
    return { ok: false, reason: "nonce_missing" };
  }

  return { ok: true, email, subject: payload.sub, nonce };
}
