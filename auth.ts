import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ALLOWED_EMAILS: string[] = [
  "bradlyls95@gmail.com",
  "brad@uxprogramming.com",
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    signIn({ profile }) {
      return ALLOWED_EMAILS.includes(profile?.email ?? "");
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
