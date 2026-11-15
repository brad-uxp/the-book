import type { NextConfig } from "next";
import { SYNC_PUSH_MAX_BYTES } from "./lib/sync-protocol";

/**
 * How much of a request body Next buffers for the proxy, before any handler
 * or credential check runs: the largest body a route accepts (the phone's sync
 * push, SYNC_PUSH_MAX_BYTES) plus room for that route to answer 413 itself.
 * The default is 10 MB, which any caller could make the one replica hold per
 * connection without signing in. Past this, Next cuts the body short, so it
 * must stay above every route's own cap (next.config.test.ts checks the sync
 * one, the largest).
 */
const PROXY_BODY_MAX_BYTES = SYNC_PUSH_MAX_BYTES + 1024 * 1024;

// CSP origin for the storage backend.
// In production R2 derives from R2_ACCOUNT_ID → use the wildcard.
// In local dev R2_ENDPOINT points to MinIO (http://localhost:9100) → use that origin.
const storageConnectSrc = (() => {
  const endpoint = process.env.R2_ENDPOINT;
  if (!endpoint) return "https://*.r2.cloudflarestorage.com";
  try {
    return new URL(endpoint).origin;
  } catch {
    return "https://*.r2.cloudflarestorage.com";
  }
})();

/**
 * The image files in /public, each at its own path. Only these get the short
 * public cache below. The rule used to go by extension (`/:path*.png` and the
 * like), which also matched /api/… and page paths: the proxy's auth wrapper
 * adds the owner's refreshed session cookie (Set-Cookie) to those responses,
 * and a shared cache must never keep one of them. next.config.test.ts keeps
 * this list equal to what /public holds.
 */
const PUBLIC_IMAGES = [
  "/file.svg",
  "/globe.svg",
  "/logo.svg",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
];

const nextConfig: NextConfig = {
  turbopack: {},
  experimental: {
    proxyClientMaxBodySize: PROXY_BODY_MAX_BYTES,
  },
  images: {
    // Served as they are: no image optimizer. /_next/image sits outside the
    // proxy (no sign-in), so with a remote pattern anyone could make this one
    // server fetch and re-encode any Google user's images, as many as they
    // liked. The only remote image is the owner's 32 px avatar, which the
    // browser now loads from lh3 directly (the CSP's img-src allows https:).
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // No CORS headers on the API, deliberately.
        //
        // This used to send `Access-Control-Allow-Origin: *` together with
        // `Allow-Headers: Authorization`. That was harmless only while nothing
        // read the Authorization header; now that API tokens exist, it would
        // mean any page in any browser could use a leaked token AND read the
        // response, instead of the browser blocking it.
        //
        // Nothing legitimate needs it: the web UI is same-origin, and machine
        // clients call server-side, where CORS does not apply at all.
        source: "/api/:path*",
        headers: [{ key: "Vary", value: "Origin" }],
      },
      {
        // The kill-switch worker that removes the retired PWA (see its header).
        // Browsers already bypass the HTTP cache when re-checking a worker
        // script, but a proxy or CDN in between would not — and a stale copy
        // of the old worker there would keep it alive.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      // The images in /public: short cache + revalidate so deploys show changes
      // fast. By exact path only (PUBLIC_IMAGES).
      ...PUBLIC_IMAGES.map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "public, max-age=60, stale-while-revalidate=300" },
        ],
      })),
      {
        source: "/(.*)",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // A page this app opens on another site gets no window.opener, so it
          // cannot send the book tab to a lookalike login. Links in notes open
          // that way.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self'",
              `connect-src 'self' ${storageConnectSrc}`,
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
