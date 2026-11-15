/**
 * Who may use book. at all — the web session and the mobile app alike.
 *
 * Its own module, with no imports, so the mobile sign-in route can check the
 * same list without loading NextAuth. auth.ts re-exports it; there is one list.
 */
export const ALLOWED_EMAILS: readonly string[] = [
  "bradlyls95@gmail.com",
  "brad@uxprogramming.com",
];

export function isAllowedEmail(email: unknown): email is string {
  return typeof email === "string" && ALLOWED_EMAILS.includes(email);
}

/**
 * Who may mint a credential that outlives the session: a subset of
 * ALLOWED_EMAILS, never wider. That is the phone's sign-in (a 90-day token,
 * app/api/mobile/sign-in), an API token in Settings (up to a year,
 * requireCredentialSession in lib/api.ts) and an OAuth connection for the MCP
 * (it renews itself, app/oauth/authorize).
 *
 * Only the personal Gmail account. A Google Workspace account
 * (brad@uxprogramming.com) can be reset or recreated by that domain's admins —
 * acceptable for a 12-hour web session, not for a credential that outlives it
 * by months. Decided by the owner on 2026-09-27 for the phone, and on
 * 2026-11-15 for Settings tokens and OAuth connections too. The Workspace
 * account can still list and revoke them.
 */
export const CREDENTIAL_EMAILS: readonly string[] = ["bradlyls95@gmail.com"].filter(
  (email) => ALLOWED_EMAILS.includes(email)
);

export function isCredentialEmail(email: unknown): email is string {
  return typeof email === "string" && CREDENTIAL_EMAILS.includes(email);
}
