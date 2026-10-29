import type { OAuthGrant, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { generateToken } from "@/lib/api-tokens";
import { fetchClientMetadata, type ClientMetadata } from "@/lib/oauth-clients";
import {
  ACCESS_TOKEN_TTL_MS,
  CODE_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  grantedScope,
  hashSecret,
  isAllowedClientId,
  isAllowedRedirect,
  isLoopbackRedirect,
  isMcpResource,
  isPkceChallenge,
  mcpResource,
  newSecret,
  pkceMatches,
  publicOrigin,
} from "@/lib/oauth";

/**
 * The writes of theBook's OAuth server (lib/oauth.ts has the rules): the
 * authorization request, its code, the token exchange, refresh rotation and
 * revoking a connection (an OAuthGrant).
 *
 * An access token is an ApiToken of kind `agent`, an hour long, tied to its
 * connection and bound to the MCP (`audience`): lib/api.ts verifies it like
 * any token, and requireAgentToken checks where it is for. Refresh tokens
 * rotate; a used one coming back means it leaked, and the connection goes.
 */

type Db = Prisma.TransactionClient;

/** A refresh token used again this soon after its rotation is the client retrying, not a thief. */
const REFRESH_REUSE_GRACE_MS = 30_000;
const DAY_MS = 24 * 60 * 60_000;

export interface AuthorizeRequest {
  client_id: string;
  /** What the consent screen calls the client: the name its document gives, or "Claude". */
  client_name: string;
  redirect_uri: string;
  /** The code goes to a port on the owner's machine (Claude Code). */
  loopback: boolean;
  scope: string;
  resource: string;
  code_challenge: string;
  state: string | null;
}

export type AuthorizeCheck =
  | { ok: true; request: AuthorizeRequest }
  /** `redirect`: where to send the error, once the client and its redirect are known to be good; otherwise it is shown here. */
  | { ok: false; error: string; description: string; redirect: string | null };

/** The authorization response's URL: the code (or the error), the state, and who issued it (RFC 9207). */
export function authorizationResponseUrl(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  url.searchParams.set("iss", publicOrigin());
  return url.toString();
}

/**
 * Checks an authorization request (the query of /oauth/authorize), in the
 * order RFC 6749 §4.1.2.1 asks: while the client or its redirect is in doubt,
 * nothing is redirected anywhere; after that, errors go back to the client.
 */
export async function checkAuthorizeRequest(
  params: Record<string, string | undefined>,
  fetchClient: (clientId: string) => Promise<ClientMetadata | null> = fetchClientMetadata
): Promise<AuthorizeCheck> {
  const shown = (description: string) => ({ ok: false, error: "invalid_request", description, redirect: null }) as const;

  const clientId = params.client_id ?? "";
  if (!isAllowedClientId(clientId)) return shown("This app is not one theBook connects to.");
  const client = await fetchClient(clientId);
  if (!client) return shown("theBook could not read this app's registration from claude.ai.");

  const redirectUri = params.redirect_uri ?? "";
  if (!isAllowedRedirect(redirectUri, client.redirect_uris)) {
    return shown("This app asked to be sent somewhere theBook does not send codes to.");
  }

  const state = params.state ?? null;
  const back = (error: string, description: string) =>
    ({ ok: false, error, description, redirect: authorizationResponseUrl(redirectUri, { error, error_description: description, state }) }) as const;

  if (params.response_type !== "code") return back("unsupported_response_type", "Only response_type=code");
  if (params.code_challenge_method !== "S256" || !isPkceChallenge(params.code_challenge ?? "")) {
    return back("invalid_request", "PKCE with S256 is required");
  }
  if (!isMcpResource(params.resource)) return back("invalid_target", `resource must be ${mcpResource()}`);
  const scope = grantedScope(params.scope);
  if (!scope) return back("invalid_scope", "The only scope is issues");
  if (state !== null && state.length > 1_000) return back("invalid_request", "state too long");

  return {
    ok: true,
    request: {
      client_id: clientId,
      client_name: (client.client_name ?? "Claude").slice(0, 100),
      redirect_uri: redirectUri,
      loopback: isLoopbackRedirect(redirectUri),
      scope,
      resource: mcpResource(),
      code_challenge: params.code_challenge!,
      state,
    },
  };
}

/** The owner approved: a code for the client, valid for minutes and for one exchange. */
export async function createCode(request: AuthorizeRequest, now = new Date()): Promise<string> {
  const code = newSecret("tbc_");
  await prisma.$transaction([
    // Old codes are dead weight; a used one only matters while it could be replayed.
    prisma.oAuthCode.deleteMany({ where: { expires_at: { lt: new Date(now.getTime() - DAY_MS) } } }),
    prisma.oAuthCode.create({
      data: {
        code_hash: hashSecret(code),
        client_id: request.client_id,
        client_name: request.client_name,
        redirect_uri: request.redirect_uri,
        scope: request.scope,
        resource: request.resource,
        code_challenge: request.code_challenge,
        expires_at: new Date(now.getTime() + CODE_TTL_MS),
      },
    }),
  ]);
  return code;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export type TokenResult =
  | { ok: true; tokens: TokenResponse }
  | { ok: false; error: "invalid_grant" | "invalid_target"; description: string };

const invalidGrant = (description: string) => ({ ok: false, error: "invalid_grant", description }) as const;

/** The name an access token of `grant` goes by in the audit log: the client and its connection. */
export function connectionLabel(grant: Pick<OAuthGrant, "id" | "client_name">): string {
  return `${grant.client_name} · ${grant.id.slice(0, 8)}`;
}

async function issueTokens(db: Db, grant: OAuthGrant, now: Date): Promise<TokenResponse> {
  const access = generateToken();
  await db.apiToken.create({
    data: {
      name: connectionLabel(grant),
      kind: "agent",
      token_prefix: access.prefix,
      token_hash: access.hash,
      expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      oauth_grant_id: grant.id,
      audience: grant.resource,
    },
  });
  const refresh = newSecret("tbr_");
  await db.oAuthRefreshToken.create({
    data: { token_hash: hashSecret(refresh), grant_id: grant.id, expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS) },
  });
  return {
    access_token: access.token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: refresh,
    scope: grant.scope,
  };
}

/** Revokes a connection and every access token it issued, in the transaction it is given. */
async function revokeIn(db: Db, grantId: string, now: Date): Promise<boolean> {
  const { count } = await db.oAuthGrant.updateMany({ where: { id: grantId, revoked_at: null }, data: { revoked_at: now } });
  await db.apiToken.updateMany({ where: { oauth_grant_id: grantId, revoked_at: null }, data: { revoked_at: now } });
  return count > 0;
}

function audit(grant: Pick<OAuthGrant, "id" | "client_name">, action: "create" | "delete", actor: string, details: Prisma.InputJsonValue) {
  auditLog({
    entity_type: "oauth_grant",
    entity_id: grant.id,
    entity_name: grant.client_name,
    action,
    actor_email: actor,
    ...(action === "create" ? { after: details } : { before: details }),
  });
}

/**
 * The authorization_code grant: a code, once, by the client it was issued to,
 * with the verifier of its challenge. A code used twice revokes the
 * connection its first use created.
 */
export async function exchangeCode(
  input: { code: string; code_verifier: string; redirect_uri: string; client_id: string; resource?: string },
  now = new Date()
): Promise<TokenResult> {
  const hash = hashSecret(input.code);
  const result = await prisma.$transaction(async (tx) => {
    const code = await tx.oAuthCode.findUnique({ where: { code_hash: hash } });
    if (!code) return { result: invalidGrant("Unknown code") };
    if (code.used_at) {
      const revoked = code.grant_id ? await revokeIn(tx, code.grant_id, now) : false;
      return { result: invalidGrant("Code already used"), revoked: revoked ? code.grant_id : null, client_name: code.client_name };
    }
    if (code.expires_at <= now) return { result: invalidGrant("Code expired") };
    if (input.client_id !== code.client_id || input.redirect_uri !== code.redirect_uri) {
      return { result: invalidGrant("client_id or redirect_uri does not match the code") };
    }
    if (input.resource !== undefined && !isMcpResource(input.resource)) {
      return { result: { ok: false, error: "invalid_target", description: `resource must be ${code.resource}` } as const };
    }
    if (!pkceMatches(input.code_verifier, code.code_challenge)) return { result: invalidGrant("PKCE verifier does not match") };

    // Spent here, inside the write: of two exchanges at once, one finds it already used.
    const spent = await tx.oAuthCode.updateMany({ where: { code_hash: hash, used_at: null }, data: { used_at: now } });
    if (spent.count === 0) return { result: invalidGrant("Code already used") };

    const grant = await tx.oAuthGrant.create({
      data: {
        client_id: code.client_id,
        client_name: code.client_name,
        redirect_uri: code.redirect_uri,
        scope: code.scope,
        resource: code.resource,
        last_used_at: now,
      },
    });
    await tx.oAuthCode.update({ where: { code_hash: hash }, data: { grant_id: grant.id } });
    return { result: { ok: true, tokens: await issueTokens(tx, grant, now) } as const, created: grant };
  });

  if ("created" in result && result.created) {
    const g = result.created;
    audit(g, "create", "oauth", { client_id: g.client_id, redirect_uri: g.redirect_uri, scope: g.scope, resource: g.resource });
  }
  if ("revoked" in result && result.revoked) {
    audit({ id: result.revoked, client_name: result.client_name! }, "delete", "oauth", { revoked_by: "a code used twice" });
  }
  return result.result;
}

/**
 * The refresh_token grant: rotates the refresh token and issues a new access
 * token. A refresh token used again after the grace window revokes the
 * connection — one of the two holders is not the client.
 */
export async function refreshTokens(
  input: { refresh_token: string; client_id: string; resource?: string },
  now = new Date()
): Promise<TokenResult> {
  const hash = hashSecret(input.refresh_token);
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.oAuthRefreshToken.findUnique({ where: { token_hash: hash }, include: { grant: true } });
    if (!row || row.grant.revoked_at) return { result: invalidGrant("Unknown or revoked refresh token") };
    if (input.client_id !== row.grant.client_id) return { result: invalidGrant("client_id does not match") };
    if (row.used_at) {
      if (now.getTime() - row.used_at.getTime() <= REFRESH_REUSE_GRACE_MS) {
        return { result: invalidGrant("Refresh token already rotated") };
      }
      await revokeIn(tx, row.grant_id, now);
      return { result: invalidGrant("Refresh token reused"), revoked: row.grant };
    }
    if (row.expires_at <= now) return { result: invalidGrant("Refresh token expired") };
    if (input.resource !== undefined && !isMcpResource(input.resource)) {
      return { result: { ok: false, error: "invalid_target", description: `resource must be ${row.grant.resource}` } as const };
    }

    const spent = await tx.oAuthRefreshToken.updateMany({ where: { token_hash: hash, used_at: null }, data: { used_at: now } });
    if (spent.count === 0) return { result: invalidGrant("Refresh token already rotated") };

    // What the connection no longer needs: access tokens past their hour, refresh tokens past their month.
    await tx.apiToken.deleteMany({ where: { oauth_grant_id: row.grant_id, expires_at: { lt: now } } });
    await tx.oAuthRefreshToken.deleteMany({ where: { grant_id: row.grant_id, expires_at: { lt: now } } });
    const grant = await tx.oAuthGrant.update({ where: { id: row.grant_id }, data: { last_used_at: now } });
    return { result: { ok: true, tokens: await issueTokens(tx, grant, now) } as const };
  });

  if ("revoked" in result && result.revoked) {
    audit(result.revoked, "delete", "oauth", { revoked_by: "a refresh token used twice" });
  }
  return result.result;
}

/** The owner's open connections, for Settings. */
export function listConnections() {
  return prisma.oAuthGrant.findMany({
    where: { revoked_at: null },
    orderBy: { created_at: "desc" },
    select: { id: true, client_name: true, redirect_uri: true, scope: true, created_at: true, last_used_at: true },
  });
}

/** Revokes a connection from Settings: its next call is a 401. False when there was nothing open to revoke. */
export async function revokeConnection(id: string, actor: string | null, now = new Date()): Promise<boolean> {
  const grant = await prisma.oAuthGrant.findUnique({ where: { id }, select: { id: true, client_name: true } });
  if (!grant) return false;
  const revoked = await prisma.$transaction((tx) => revokeIn(tx, id, now));
  if (revoked) audit(grant, "delete", actor ?? "unknown", { revoked_by: "the owner, in Settings" });
  return revoked;
}
