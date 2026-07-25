import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

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

const nextConfig: NextConfig = {
  turbopack: {},
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
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
        // Static assets in /public — short cache + revalidate so deploys show changes fast
        source: "/:path*.(svg|png|jpg|jpeg|ico|webp)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=60, stale-while-revalidate=300" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
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

export default withSerwist(nextConfig);
