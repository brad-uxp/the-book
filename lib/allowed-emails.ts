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
 * Who may sign in from the phone: a subset of ALLOWED_EMAILS, never wider.
 *
 * A mobile sign-in mints a 90-day API token, far longer-lived than a 12-hour
 * web session, so it is limited to the personal Gmail account. A Google
 * Workspace account (brad@uxprogramming.com) can be reset or recreated by that
 * domain's admins — acceptable for a web session, not for a token that
 * outlives it by months. Decided by the owner on 2026-09-27.
 */
export const MOBILE_ALLOWED_EMAILS: readonly string[] = ["bradlyls95@gmail.com"].filter(
  (email) => ALLOWED_EMAILS.includes(email)
);
