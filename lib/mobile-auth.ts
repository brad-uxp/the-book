/**
 * Policy for signing the mobile app in. The routes under /api/mobile apply it;
 * the rules themselves live here, pure and tested.
 */

/**
 * The only routes the proxy lets through without a credential for the app —
 * it has none before signing in. Exact matches: a trailing slash, another
 * case, an encoded variant or a sub-path is NOT public, and falls through to
 * the auth gate (fail closed).
 */
const MOBILE_PUBLIC_PATHS = new Set(["/api/mobile/nonce", "/api/mobile/sign-in"]);

export function isMobilePublicPath(pathname: string): boolean {
  return MOBILE_PUBLIC_PATHS.has(pathname);
}

/**
 * How long a mobile API token lives. The same as a token made by hand in
 * Settings: a lost phone stops working on its own within three months, and
 * signing in again is one tap. Revoking from Settings, or signing out in the
 * app, ends it immediately.
 */
export const MOBILE_TOKEN_DAYS = 90;

/**
 * The most a sign-in request body may be. A real one is an ID token (~1-2 KB)
 * and a device name; anything bigger is refused before it is buffered.
 */
export const MOBILE_BODY_MAX_BYTES = 8 * 1024;

/**
 * Why there are no per-IP rate limits on /api/mobile/nonce and /sign-in:
 *
 * Nothing on these routes can be guessed. A sign-in only succeeds with a
 * Google-signed ID token for an allowed account, carrying a nonce we signed —
 * brute force has nothing to work on. What limits were buying was resistance
 * to junk traffic, and they cost more than they bought: the client IP comes
 * from a proxy header whose shape on Railway is not established, so a per-IP
 * bucket is either spoofable (useless) or shared by everyone (a way to lock
 * the owner out of their own phone). Instead every request's cost is bounded:
 * the body is capped, nonces are stateless, a malformed token is rejected
 * before any network call, and the Google key fetch has a cooldown.
 */

/**
 * The Android OAuth clients whose tokens may sign in — Google puts the client
 * that asked for the token in `azp`.
 *
 * Checked because `aud` alone (our web client) is not enough: any client in
 * the same Google Cloud project can obtain a token with that audience, and
 * that project is not dedicated to book. Only the release app qualifies in
 * production. The debug client (signed with Android Studio's well-known debug
 * key) is honoured only outside production — decided here in code, so a
 * misconfigured production environment cannot widen it.
 */
export function mobileAuthorizedParties(env: {
  NODE_ENV?: string;
  MOBILE_ANDROID_CLIENT_ID?: string;
  MOBILE_ANDROID_DEBUG_CLIENT_ID?: string;
}): string[] {
  const parties: string[] = [];
  const release = env.MOBILE_ANDROID_CLIENT_ID?.trim();
  if (release) parties.push(release);
  const debug = env.MOBILE_ANDROID_DEBUG_CLIENT_ID?.trim();
  if (debug && env.NODE_ENV !== "production") parties.push(debug);
  return parties;
}

/**
 * The name the token shows in Settings → API tokens, and in the audit log as
 * `token:<name>`. Says it is the phone, and which one.
 */
export function mobileTokenName(deviceName: string): string {
  const device = deviceName.replace(/\s+/g, " ").trim() || "Android";
  return `mobile · ${device}`.slice(0, 60);
}

/**
 * The raw X-Forwarded-For, trimmed, for refusal logs only — never for a
 * decision. Logged so production logs show what Railway actually sends, which
 * is the evidence any future per-IP limit would need first.
 */
export function forwardedForLog(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "-").slice(0, 200);
}
