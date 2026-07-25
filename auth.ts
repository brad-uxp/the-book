import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const ALLOWED_EMAILS: string[] = [
  "bradlyls95@gmail.com",
  "brad@uxprogramming.com",
];

/**
 * Single source of truth for "is this session allowed in".
 *
 * Auth.js answers a session probe with a 500-status JSON body when the
 * provider config is broken, and `auth()` surfaces that body as `req.auth` —
 * a truthy object. Anything that gates on `req.auth` alone therefore fails
 * OPEN on a misconfiguration (GHSA-8fpg-xm3f-6cx3). Checking the email, and
 * re-checking it against the allowlist, fails closed instead.
 */
export function isAllowedSession(session: unknown): boolean {
  const email = (session as { user?: { email?: unknown } } | null)?.user?.email;
  return typeof email === "string" && ALLOWED_EMAILS.includes(email);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: {
    // Without this the JWT lives 30 days and removing an address from
    // ALLOWED_EMAILS does not revoke sessions already issued.
    maxAge: 60 * 60 * 12,
  },
  callbacks: {
    signIn({ profile }) {
      return ALLOWED_EMAILS.includes(profile?.email ?? "");
    },
    // Re-check on every token refresh, not only at sign-in, so revoking an
    // address takes effect on the next request instead of in 12 hours.
    jwt({ token }) {
      if (token?.email && !ALLOWED_EMAILS.includes(token.email)) {
        return null;
      }
      return token;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
