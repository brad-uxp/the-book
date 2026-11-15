import { auth, isAllowedSession } from "@/auth";
import { NextResponse, type NextRequest } from "next/server";
import { isMobilePublicPath } from "@/lib/mobile-auth";
import { MCP_PATH, mcpUnauthorized, publicOrigin } from "@/lib/mcp-auth";
import { isReadMethod, presentsReadonlyToken, READONLY_REFUSAL } from "@/lib/readonly-token";

/**
 * Methods that change nothing. An OPTIONS preflight carries no cookies, so it
 * is no browser session's write either.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** What a signed-in browser hears when another origin tries to write through it. */
const CROSS_ORIGIN_REFUSAL =
  "Refused: a signed-in browser can only change things from book.'s own pages";

/**
 * Whether a request from a signed-in browser comes from this app's own pages.
 *
 * The session cookie is SameSite=Lax, which keeps it off cross-site requests
 * but not off another origin of the same site: a page on any other host under
 * bolstro.com could make the owner's browser POST here, with the cookie, as
 * the owner. Fetch Metadata tells them apart: every current browser sends
 * Sec-Fetch-Site, and that page's request says `same-site`, not
 * `same-origin`. A browser without it (Safari before 16.4) sends Origin on
 * every write, so Origin decides then. A request with neither header came
 * from no browser page — a script or the phone, which hold their credential
 * themselves — so there is no one to forge it.
 */
function fromOwnPages(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin" || site === "none";
  const origin = req.headers.get("origin");
  if (origin !== null) return origin === publicOrigin() || origin === req.nextUrl.origin;
  return true;
}

/**
 * theBook's OAuth, for its MCP (lib/oauth.ts): the discovery documents and
 * the token endpoint are public — a client reaches them before it has any
 * credential, and the token endpoint checks its own. The consent screen
 * (/oauth/authorize) is not: it needs the owner's session.
 */
const OAUTH_PUBLIC_PREFIX = "/.well-known/oauth-";
const OAUTH_TOKEN_PATH = "/api/oauth/token";
const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";

export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl;
  const authorization = req.headers.get("authorization");

  // A read-only token reads and nothing else, and its head says what it is
  // (lib/readonly-token.ts), so whatever is not a GET or a HEAD stops here —
  // on every path the proxy sees, before the allow-lists below and before any
  // handler. Whether the token is real is the handler's call; this only
  // refuses. requireSession refuses it again by the request's method, so a
  // handler is no weaker without this.
  if (presentsReadonlyToken(authorization) && !isReadMethod(req.method)) {
    return NextResponse.json({ error: READONLY_REFUSAL }, { status: 403 });
  }

  // A signed-in browser changes things only from book.'s own pages
  // (fromOwnPages): on every path, the API, server actions and /api/auth
  // alike. Only requests that carry a session: the public token, sign-in and
  // cron endpoints take no cookie and are called from no page of ours. A
  // truthy req.auth that is an Auth.js error object gets checked too, which
  // only refuses more.
  if (!SAFE_METHODS.has(req.method) && req.auth && !fromOwnPages(req)) {
    return NextResponse.json({ error: CROSS_ORIGIN_REFUSAL }, { status: 403 });
  }

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

  if (pathname.startsWith(OAUTH_PUBLIC_PREFIX) || pathname === OAUTH_TOKEN_PATH) {
    return NextResponse.next();
  }

  // Machine clients present a Bearer token. It cannot be verified here — this
  // runs on the Edge runtime, which has no database — so the request is passed
  // to the handler, where requireSession() validates it against ApiToken and
  // returns 401 if it does not check out. Nothing is trusted at this point;
  // only the cheap "is this even a token request" test happens.
  if (pathname.startsWith("/api/") && /^Bearer\s+(tb_|tbro_)/i.test(authorization ?? "")) {
    return NextResponse.next();
  }

  // Authenticated via NextAuth session (web) — allow through.
  // Deliberately NOT `if (req.auth)`: on an Auth.js config error req.auth holds
  // an error object, which is truthy and would let every request through.
  if (isAllowedSession(req.auth)) {
    return NextResponse.next();
  }

  // Not authenticated. The MCP says how to authenticate, as clients expect.
  if (pathname === MCP_PATH) {
    return mcpUnauthorized(authorization !== null);
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Signing in from the consent screen comes back to it (app/login/page.tsx).
  const login = new URL("/login", req.url);
  if (pathname === OAUTH_AUTHORIZE_PATH) {
    login.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
  }
  return NextResponse.redirect(login);
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
