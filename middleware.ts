import { NextRequest, NextResponse } from "next/server";

/**
 * Soft authentication middleware.
 *
 * Disabled by default. To enable, set ADMIN_KEY in your env:
 *   ADMIN_KEY=some-secret-key
 *
 * When enabled, all requests must include either:
 *   - Cookie: admin_key=<value>
 *   - Header: x-admin-key: <value>
 *
 * The cron route /api/cron/daily uses CRON_SECRET instead and is always excluded here.
 */
export function middleware(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY;

  // If ADMIN_KEY is not set, auth is disabled — allow all traffic
  if (!adminKey) {
    return NextResponse.next();
  }

  // Cron is protected by its own CRON_SECRET, skip here
  if (req.nextUrl.pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  const cookieKey = req.cookies.get("admin_key")?.value;
  const headerKey = req.headers.get("x-admin-key");

  if (cookieKey === adminKey || headerKey === adminKey) {
    return NextResponse.next();
  }

  // For API routes, return 401
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For page routes, redirect to login page (basic)
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("redirect", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
