import { auth, isAllowedSession } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl;

  // Always allow: login page, auth endpoints, cron
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron")
  ) {
    return NextResponse.next();
  }

  // Authenticated via NextAuth session (web) — allow through.
  // Deliberately NOT `if (req.auth)`: on an Auth.js config error req.auth holds
  // an error object, which is truthy and would let every request through.
  if (isAllowedSession(req.auth)) {
    return NextResponse.next();
  }

  // Not authenticated
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", req.url));
});

export const config = {
  matcher: [
    // Static assets are excluded so they are not gated. `/api/:path*` is listed
    // unconditionally afterwards because the image-extension exclusion below
    // would otherwise let any API path ending in .png/.svg/… skip the proxy.
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|swe-worker-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/api/:path*",
  ],
};
