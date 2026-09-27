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
