import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/oauth";

/**
 * The MCP's protected resource metadata (RFC 9728): which authorization
 * server issues its tokens. Served at the path the 401 points to
 * (/.well-known/oauth-protected-resource/api/mcp) and at the bare path,
 * which clients try when the 401 says nothing. One resource; other paths 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ resource?: string[] }> }) {
  const { resource } = await params;
  const path = resource ? `/${resource.join("/")}` : "";
  if (path !== "" && path !== "/api/mcp") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(protectedResourceMetadata(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
