import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { MCP_SCOPE, mcpResource, publicOrigin, resourceMetadataUrl } from "./mcp-auth";

/**
 * theBook as the OAuth 2.1 authorization server of its own MCP (F3 of
 * docs/product/features/agentes-y-mcp.md): the rules, pure. The writes are in
 * lib/oauth-service.ts, fetching a client's metadata in lib/oauth-clients.ts.
 *
 * Closed by design. The only clients are Claude's — identified by a Client ID
 * Metadata Document (CIMD) that Anthropic publishes on claude.ai — and a code
 * only ever goes to Claude's hosted callback or to a loopback port on the
 * owner's machine (Claude Code). There is no dynamic registration: nothing to
 * register is nothing to abuse. Codes, refresh tokens and access tokens are
 * all 256 random bits, stored as their sha256 only.
 */

export const CODE_TTL_MS = 60_000;
export const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

/** The origin every client's metadata document is on. */
export const CLIENT_ID_ORIGIN = "https://claude.ai";

/** Where Claude's hosted apps (web, Desktop, mobile, Cowork) take the code. */
export const HOSTED_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** The path Claude Code's loopback redirect uses, on whatever port it bound. */
const LOOPBACK_CALLBACK_PATH = "/callback";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A URL in RFC 8707's canonical form — lowercase scheme and host, no default
 * port, no trailing slash — or null when it is not an absolute http(s) URL
 * without a query or fragment.
 */
export function canonicalResource(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

/** Whether `resource` names this MCP. Required on every request: it is the tokens' audience. */
export function isMcpResource(resource: string | undefined | null): boolean {
  return !!resource && canonicalResource(resource) === canonicalResource(mcpResource());
}

/** Whether `clientId` is a metadata document URL theBook will fetch: https on claude.ai. */
export function isAllowedClientId(clientId: string): boolean {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  return (
    url.origin === CLIENT_ID_ORIGIN &&
    url.pathname.length > 1 &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  );
}

function loopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Whether a code may go to `redirectUri`: it is one of the two shapes theBook
 * ever sends codes to, and the client's own document lists it. Loopback URIs
 * match whatever their port (RFC 8252 §7.3), `localhost` included because
 * Claude Code declares it.
 */
export function isAllowedRedirect(redirectUri: string, registered: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.search || url.hash || url.username || url.password) return false;
  if (redirectUri === HOSTED_CALLBACK) return registered.includes(HOSTED_CALLBACK);
  if (!loopback(url) || url.pathname !== LOOPBACK_CALLBACK_PATH) return false;
  return registered.some((entry) => {
    try {
      const listed = new URL(entry);
      return loopback(listed) && listed.hostname === url.hostname && listed.pathname === url.pathname;
    } catch {
      return false;
    }
  });
}

/** Whether a redirect goes to the owner's own machine, which any local program could be listening on. */
export function isLoopbackRedirect(redirectUri: string): boolean {
  try {
    return loopback(new URL(redirectUri));
  } catch {
    return false;
  }
}

const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isPkceChallenge(challenge: string): boolean {
  return PKCE_CHALLENGE.test(challenge);
}

/** PKCE with S256 (RFC 7636): the verifier's sha256, base64url, is the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER.test(verifier) || !isPkceChallenge(challenge)) return false;
  const digest = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

/**
 * The scope a request gets: `issues`, the only one there is. Asking for none
 * gets it; `offline_access` is accepted and needs nothing (a connection always
 * gets a refresh token); anything else is refused.
 */
export function grantedScope(requested: string | undefined | null): string | null {
  const asked = (requested ?? "").split(" ").filter(Boolean);
  if (asked.some((s) => s !== MCP_SCOPE && s !== "offline_access")) return null;
  return MCP_SCOPE;
}

/** A new code or refresh token: a recognisable head and 256 random bits. */
export function newSecret(head: "tbc_" | "tbr_"): string {
  return `${head}${randomBytes(32).toString("base64url")}`;
}

/** What is stored of a code or refresh token. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Where the consent screen lives; signing in returns there and nowhere else (loginReturnPath). */
export const AUTHORIZE_PATH = "/oauth/authorize";

/**
 * Where the login page sends the owner after Google: back to the consent
 * screen they were on, or home. Only the consent screen, on this origin —
 * anything else would make /login an open redirect.
 */
export function loginReturnPath(callbackUrl: string | undefined | null): string {
  if (!callbackUrl) return "/";
  if (callbackUrl !== AUTHORIZE_PATH && !callbackUrl.startsWith(`${AUTHORIZE_PATH}?`)) return "/";
  if (/[\\\s]/.test(callbackUrl)) return "/";
  return callbackUrl;
}

/** The MCP's protected resource metadata (RFC 9728). */
export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [publicOrigin()],
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_SCOPE],
    resource_name: "theBook",
  };
}

/** The authorization server's metadata (RFC 8414). */
export function authorizationServerMetadata() {
  const origin = publicOrigin();
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}/api/oauth/token`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Claude is a public client: PKCE, not a secret, protects the exchange.
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    scopes_supported: [MCP_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

export { MCP_SCOPE, mcpResource, publicOrigin, resourceMetadataUrl };
