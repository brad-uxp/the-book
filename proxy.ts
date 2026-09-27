import { auth, isAllowedSession } from "@/auth";
import { NextResponse } from "next/server";
import { isMobilePublicPath } from "@/lib/mobile-auth";

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

  // The mobile app's way in: it has no credential yet. Exact paths only — the
  // handlers verify Google's ID token and a single-use nonce. Everything else
  // under /api/mobile (sign-out) needs a token like any route.
  if (isMobilePublicPath(pathname)) {
    return NextResponse.next();
  }

  // Machine clients present a Bearer token. It cannot be verified here — this
  // runs on the Edge runtime, which has no database — so the request is passed
  // to the handler, where requireSession() validates it against ApiToken and
  // returns 401 if it does not check out. Nothing is trusted at this point;
  // only the cheap "is this even a token request" test happens.
  const authorization = req.headers.get("authorization");
  if (pathname.startsWith("/api/") && /^Bearer\s+tb_/i.test(authorization ?? "")) {
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
    //
    // sw.js is the kill switch for the retired PWA worker and must stay
    // reachable without a session: a browser re-checking it and getting a
    // redirect to /login keeps the old worker. Drop the exclusion together
    // with public/sw.js.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/api/:path*",
  ],
};
