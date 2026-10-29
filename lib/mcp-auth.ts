/**
 * Where the MCP lives and how it asks a client to authenticate. No imports:
 * proxy.ts answers the same 401 before a request reaches the handler.
 */

export const MCP_PATH = "/api/mcp";

/** The scope an MCP connection asks for: an agent working issues (lib/oauth.ts). */
export const MCP_SCOPE = "issues";

/**
 * The origin theBook is served from — the OAuth issuer and the MCP's host.
 * From AUTH_URL, never from a request's Host header: the issuer and the
 * tokens' audience must not be whatever a client claims.
 */
export function publicOrigin(): string {
  const url = process.env.AUTH_URL;
  return url ? new URL(url).origin : "https://book.bolstro.com";
}

/** The MCP's URL: the resource its tokens are for (their audience). */
export function mcpResource(): string {
  return `${publicOrigin()}${MCP_PATH}`;
}

/** Where a client reads the MCP's protected resource metadata (RFC 9728). */
export function resourceMetadataUrl(): string {
  return `${publicOrigin()}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/**
 * The 401 for a request without a valid Bearer, with the WWW-Authenticate
 * challenge (RFC 6750, RFC 9728) that starts a client's OAuth: where the
 * resource metadata is, the scope to ask for, and `error="invalid_token"`
 * when one was presented — expired, revoked, or meant for somewhere else.
 */
export function mcpUnauthorized(presentedCredential: boolean): Response {
  const challenge = [
    'Bearer realm="book"',
    ...(presentedCredential ? ['error="invalid_token"'] : []),
    `resource_metadata="${resourceMetadataUrl()}"`,
    `scope="${MCP_SCOPE}"`,
  ].join(", ");
  return Response.json(
    { error: "invalid_token", error_description: "Sign in to theBook to use its MCP" },
    { status: 401, headers: { "WWW-Authenticate": challenge } }
  );
}
