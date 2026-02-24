import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  // Always allow: login page, auth endpoints, cron
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron")
  ) {
    return NextResponse.next();
  }

  // Authenticated via NextAuth session (web) — allow through
  if (req.auth) {
    return NextResponse.next();
  }

  // Check Bearer token (mobile)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token);
    if (payload) {
      return NextResponse.next();
    }
  }

  // Not authenticated
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", req.url));
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
