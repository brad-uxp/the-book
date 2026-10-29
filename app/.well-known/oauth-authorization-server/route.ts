import { NextResponse } from "next/server";
import { authorizationServerMetadata } from "@/lib/oauth";

/**
 * theBook's OAuth authorization server metadata (RFC 8414), where a client
 * finds the endpoints after reading the MCP's protected resource metadata.
 * Public: proxy.ts lets /.well-known/oauth-* through.
 */
export function GET() {
  return NextResponse.json(authorizationServerMetadata(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
