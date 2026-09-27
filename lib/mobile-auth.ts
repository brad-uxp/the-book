/**
 * Policy for signing the mobile app in. The routes under /api/mobile apply it;
 * the rules themselves live here, pure and tested.
 */

/**
 * How long a mobile API token lives. The same as a token made by hand in
 * Settings: a lost phone stops working on its own within three months, and
 * signing in again is one tap. Revoking from Settings, or signing out in the
 * app, ends it immediately.
 */
export const MOBILE_TOKEN_DAYS = 90;

export const SIGN_IN_LIMITS = {
  /** Any sign-in request, per client IP. */
  perIp: { max: 10, windowMs: 60_000 },
  /** Failed sign-ins, per client IP. A real user fails rarely. */
  failuresPerIp: { max: 5, windowMs: 15 * 60_000 },
  /** Failed sign-ins from everywhere, so spreading across IPs doesn't help. */
  failuresGlobal: { max: 50, windowMs: 60 * 60_000 },
  /** Nonce requests, per client IP. */
  noncesPerIp: { max: 20, windowMs: 60_000 },
} as const;

export const rateKeys = {
  signIn: (ip: string) => `mobile:sign-in:${ip}`,
  failIp: (ip: string) => `mobile:fail:${ip}`,
  failGlobal: "mobile:fail:*",
  nonce: (ip: string) => `mobile:nonce:${ip}`,
};

/**
 * The address the request came from, as Railway's edge saw it.
 *
 * The rightmost X-Forwarded-For entry is the one our own proxy appended; any
 * entry to its left came from the client and can be anything. Taking the
 * leftmost would let a client pick its own rate-limit bucket.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * The name the token shows in Settings → API tokens, and in the audit log as
 * `token:<name>`. Says it is the phone, and which one.
 */
export function mobileTokenName(deviceName: string): string {
  const device = deviceName.replace(/\s+/g, " ").trim() || "Android";
  return `mobile · ${device}`.slice(0, 60);
}
