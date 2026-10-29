/**
 * Where the MCP lives and how it asks a client to authenticate. No imports:
 * proxy.ts runs on the Edge and answers the same 401 before a request reaches
 * the handler.
 */

export const MCP_PATH = "/api/mcp";

/**
 * The 401 for a request without a valid Bearer, with the WWW-Authenticate
 * challenge (RFC 6750) an MCP client reads to decide how to sign in —
 * `error="invalid_token"` when it did present one. F3 adds
 * `resource_metadata="…"` here, pointing at theBook's OAuth metadata, and
 * Claude's OAuth discovery starts from this same answer.
 */
export function mcpUnauthorized(presentedCredential: boolean): Response {
  const challenge = presentedCredential ? 'Bearer realm="book", error="invalid_token"' : 'Bearer realm="book"';
  return Response.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": challenge } }
  );
}
