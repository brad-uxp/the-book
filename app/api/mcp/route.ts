import { NextRequest, NextResponse } from "next/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { getWriter, readJsonLimited, requireAgentToken } from "@/lib/api";
import { issuesMcpServer } from "@/lib/mcp-issues";

export const runtime = "nodejs";

/**
 * Bigger than any one call should be: a note is at most RICH_TEXT_MAX
 * characters, a few bytes each once in UTF-8 and JSON. Read with a cap so a
 * client cannot make the server hold whatever it sends.
 */
const MCP_BODY_MAX_BYTES = 1024 * 1024;

/**
 * theBook's MCP (lib/mcp-issues.ts) over Streamable HTTP, without sessions:
 * each request gets a fresh server for its caller, and nothing is kept
 * between requests — the in-memory rate limit is the only shared state, as
 * everywhere else. POST only: with no sessions there is no stream to GET and
 * none to DELETE, and Next answers those with a 405.
 *
 * Agent tokens only (requireAgentToken). Without one, a 401 whose
 * WWW-Authenticate challenge F3 extends into OAuth discovery.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAgentToken();
  if (denied) return denied;

  const body = await readJsonLimited(req, MCP_BODY_MAX_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? NextResponse.json({ error: "Request too large" }, { status: 413 })
      : NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  // One message per request. The 2025 protocol allowed batches, which would
  // let a request carry a hundred tool calls for the price of one against
  // the rate limit; clients today send one, and the 2025-06-18 revision on
  // dropped them.
  if (Array.isArray(body.value)) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not accepted" } },
      { status: 400 }
    );
  }

  // requireAgentToken let in an agent token only; pinned anyway, so this
  // endpoint can never write as the owner.
  const writer = { ...(await getWriter()), access: "agent" as const };
  const handler = createMcpHandler(() => issuesMcpServer(writer), {
    // No subscriptions/listen: nothing here changes on its own, and with a
    // handler per request the SDK's own cap on open streams would never bind.
    maxSubscriptions: 0,
    onerror: (err) => console.error("[mcp]", err.message),
  });
  return handler.fetch(req, { parsedBody: body.value });
}
