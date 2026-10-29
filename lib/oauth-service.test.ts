import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// The OAuth tables, in memory: enough of Prisma's surface for the service,
// with updateMany checking its where-clause against the rows as they are.
const db = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables = { codes: new Map<string, Row>(), grants: new Map<string, Row>(), refresh: new Map<string, Row>(), tokens: [] as Row[] };
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const op = v as { lt?: Date; not?: unknown };
        if (op.lt) return (row[k] as Date) < op.lt;
        return row[k] !== op.not;
      }
      return row[k] === v;
    });
  let ids = 0;
  const client = {
    oAuthCode: {
      findUnique: async ({ where }: { where: Row }) => tables.codes.get(where.code_hash as string) ?? null,
      create: async ({ data }: { data: Row }) => (tables.codes.set(data.code_hash as string, { used_at: null, grant_id: null, ...data }), data),
      update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(tables.codes.get(where.code_hash as string)!, data),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = tables.codes.get(where.code_hash as string);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      deleteMany: async () => ({ count: 0 }),
    },
    oAuthGrant: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `grant-${++ids}0000000`, revoked_at: null, created_at: new Date(), ...data };
        tables.grants.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(tables.grants.get(where.id as string)!, data),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = tables.grants.get(where.id as string);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findUnique: async ({ where }: { where: Row }) => tables.grants.get(where.id as string) ?? null,
    },
    oAuthRefreshToken: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = tables.refresh.get(where.token_hash as string);
        return row ? { ...row, grant: tables.grants.get(row.grant_id as string) } : null;
      },
      create: async ({ data }: { data: Row }) => (tables.refresh.set(data.token_hash as string, { used_at: null, ...data }), data),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = tables.refresh.get(where.token_hash as string);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      deleteMany: async () => ({ count: 0 }),
    },
    apiToken: {
      create: async ({ data }: { data: Row }) => (tables.tokens.push({ revoked_at: null, ...data }), data),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = tables.tokens.filter((t) => matches(t, where));
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };
  return {
    tables,
    reset() {
      tables.codes.clear();
      tables.grants.clear();
      tables.refresh.clear();
      tables.tokens.length = 0;
    },
    prisma: {
      ...client,
      $transaction: async (arg: unknown) =>
        typeof arg === "function" ? (arg as (tx: typeof client) => unknown)(client) : Promise.all(arg as Promise<unknown>[]),
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn() }));

import { auditLog } from "@/lib/audit";
import { resetRateLimits } from "@/lib/rate-limit";
import { mcpResource } from "@/lib/mcp-auth";
import { checkAuthorizeRequest, createCode, exchangeCode, refreshTokens, revokeConnection, type AuthorizeRequest } from "./oauth-service";

const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT = "http://localhost:3118/callback";

const request: AuthorizeRequest = {
  client_id: CLAUDE_CODE,
  client_name: "Claude Code",
  redirect_uri: REDIRECT,
  loopback: true,
  scope: "issues",
  resource: mcpResource(),
  code_challenge: CHALLENGE,
  state: "st",
};

const t0 = new Date("2026-10-29T12:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

async function connect() {
  const code = await createCode(request, t0);
  const r = await exchangeCode({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: CLAUDE_CODE, resource: mcpResource() }, later(1_000));
  if (!r.ok) throw new Error(r.description);
  return { code, tokens: r.tokens };
}

beforeEach(() => {
  db.reset();
  resetRateLimits();
  vi.mocked(auditLog).mockClear();
});

describe("la solicitud de autorización", () => {
  const document = { client_id: CLAUDE_CODE, client_name: "Claude Code", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"] };
  const fetchClient = vi.fn(async () => document);
  const params = {
    response_type: "code",
    client_id: CLAUDE_CODE,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    resource: mcpResource(),
    scope: "issues",
    state: "st",
  };

  it("válida: el cliente, su redirect loopback y la audiencia del MCP", async () => {
    const check = await checkAuthorizeRequest(params, fetchClient);
    expect(check).toMatchObject({ ok: true, request: { client_name: "Claude Code", loopback: true, scope: "issues" } });
  });

  it("un redirect no permitido se muestra acá y no se redirige a ningún lado", async () => {
    const check = await checkAuthorizeRequest({ ...params, redirect_uri: "https://evil.example/callback" }, fetchClient);
    expect(check).toMatchObject({ ok: false, redirect: null });
  });

  it("una audiencia ajena vuelve al cliente como invalid_target", async () => {
    const check = await checkAuthorizeRequest({ ...params, resource: "https://evil.example/api/mcp" }, fetchClient);
    expect(check).toMatchObject({ ok: false, error: "invalid_target" });
    expect(check.ok === false && check.redirect).toContain("error=invalid_target");
    expect(check.ok === false && check.redirect).toContain("state=st");
  });

  it("sin PKCE S256 no hay código", async () => {
    expect(await checkAuthorizeRequest({ ...params, code_challenge_method: "plain" }, fetchClient)).toMatchObject({ ok: false, error: "invalid_request" });
  });
});

describe("el canje del código", () => {
  it("emite un access token de una hora con la audiencia del MCP y un refresh", async () => {
    const { tokens } = await connect();
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "issues" });
    expect(tokens.access_token).toMatch(/^tb_/);
    expect(tokens.refresh_token).toMatch(/^tbr_/);
    expect(db.tables.tokens[0]).toMatchObject({ kind: "agent", audience: mcpResource(), expires_at: later(1_000 + 3_600_000) });
    expect(db.tables.tokens[0].token_hash).not.toBe(tokens.access_token);
    expect(vi.mocked(auditLog)).toHaveBeenCalledWith(expect.objectContaining({ entity_type: "oauth_grant", action: "create" }));
  });

  it("un verificador PKCE inválido: invalid_grant, sin conexión", async () => {
    const code = await createCode(request, t0);
    const r = await exchangeCode({ code, code_verifier: VERIFIER.replace("d", "e"), redirect_uri: REDIRECT, client_id: CLAUDE_CODE }, later(1_000));
    expect(r).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(db.tables.grants.size).toBe(0);
  });

  it("vencido: invalid_grant", async () => {
    const code = await createCode(request, t0);
    const r = await exchangeCode({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: CLAUDE_CODE }, later(60_000 + 1));
    expect(r).toMatchObject({ ok: false, error: "invalid_grant", description: "Code expired" });
  });

  it("otro redirect o cliente que el del código: invalid_grant", async () => {
    const code = await createCode(request, t0);
    expect(await exchangeCode({ code, code_verifier: VERIFIER, redirect_uri: "http://localhost:9999/callback", client_id: CLAUDE_CODE }, later(1_000))).toMatchObject({ ok: false });
  });

  it("una audiencia ajena en el canje: invalid_target", async () => {
    const code = await createCode(request, t0);
    const r = await exchangeCode({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: CLAUDE_CODE, resource: "https://evil.example/api/mcp" }, later(1_000));
    expect(r).toMatchObject({ ok: false, error: "invalid_target" });
  });

  it("usado dos veces: el segundo falla y revoca lo que hizo el primero", async () => {
    const { code } = await connect();
    const again = await exchangeCode({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: CLAUDE_CODE }, later(2_000));
    expect(again).toMatchObject({ ok: false, error: "invalid_grant" });
    const [grant] = [...db.tables.grants.values()];
    expect(grant.revoked_at).toEqual(later(2_000));
    expect(db.tables.tokens.every((t) => t.revoked_at)).toBe(true);
  });
});

describe("el refresh", () => {
  it("rota: un refresh y un access token nuevos; el viejo queda usado", async () => {
    const { tokens } = await connect();
    const r = await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(3_600_000));
    expect(r.ok && r.tokens.refresh_token).not.toBe(tokens.refresh_token);
    expect(db.tables.tokens).toHaveLength(2);
  });

  it("reusado después de la gracia: revoca la conexión entera", async () => {
    const { tokens } = await connect();
    await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(10_000));
    const reuse = await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(60_000));
    expect(reuse).toMatchObject({ ok: false, error: "invalid_grant", description: "Refresh token reused" });
    expect([...db.tables.grants.values()][0].revoked_at).toEqual(later(60_000));
    expect(db.tables.tokens.every((t) => t.revoked_at)).toBe(true);
  });

  it("reusado dentro de la gracia (el cliente reintentando): falla sin revocar", async () => {
    const { tokens } = await connect();
    await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(10_000));
    const retry = await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(20_000));
    expect(retry).toMatchObject({ ok: false, error: "invalid_grant" });
    expect([...db.tables.grants.values()][0].revoked_at).toBeNull();
  });

  it("de otro cliente, vencido o de una conexión revocada: invalid_grant", async () => {
    const { tokens } = await connect();
    expect(await refreshTokens({ refresh_token: tokens.refresh_token, client_id: "https://claude.ai/oauth/other" }, later(5_000))).toMatchObject({ ok: false });
    expect(await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(31 * 24 * 3_600_000))).toMatchObject({ ok: false, description: "Refresh token expired" });
    await revokeConnection([...db.tables.grants.keys()][0], "owner@example.com", later(6_000));
    expect(await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(7_000))).toMatchObject({ ok: false });
  });
});

describe("el refresh contra un Disconnect al mismo tiempo", () => {
  it("si la conexión se revocó entre la lectura y la escritura, no sale ningún token", async () => {
    const { tokens } = await connect();
    const id = [...db.tables.grants.keys()][0];
    const stale = { ...db.tables.grants.get(id)! };
    await revokeConnection(id, "owner@example.com", later(4_000));
    // La lectura del refresh vio la conexión todavía abierta.
    const real = db.prisma.oAuthRefreshToken.findUnique;
    db.prisma.oAuthRefreshToken.findUnique = (async (args: { where: Record<string, unknown> }) => {
      const row = await real(args);
      return row ? { ...row, grant: stale } : null;
    }) as typeof real;
    try {
      const r = await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(5_000));
      expect(r).toMatchObject({ ok: false, error: "invalid_grant", description: "Connection revoked" });
      expect(db.tables.tokens.every((t) => t.revoked_at)).toBe(true);
      expect(db.tables.tokens).toHaveLength(1);
    } finally {
      db.prisma.oAuthRefreshToken.findUnique = real;
    }
  });

  it("una conexión que refresca de más se frena, sin revocarla", async () => {
    let { tokens } = await connect();
    for (let i = 0; i < 10; i++) {
      const r = await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(10_000 + i));
      if (!r.ok) throw new Error(r.description);
      tokens = r.tokens;
    }
    const r = await refreshTokens({ refresh_token: tokens.refresh_token, client_id: CLAUDE_CODE }, later(20_000));
    expect(r).toMatchObject({ ok: false, error: "invalid_request" });
    expect([...db.tables.grants.values()][0].revoked_at).toBeNull();
  });
});

describe("desconectar desde Settings", () => {
  it("revoca la conexión y todos sus access tokens, y lo audita", async () => {
    await connect();
    const id = [...db.tables.grants.keys()][0];
    expect(await revokeConnection(id, "owner@example.com", later(5_000))).toBe(true);
    expect(db.tables.tokens.every((t) => t.revoked_at)).toBe(true);
    expect(vi.mocked(auditLog)).toHaveBeenLastCalledWith(expect.objectContaining({ action: "delete", actor_email: "owner@example.com" }));
    expect(await revokeConnection(id, "owner@example.com")).toBe(false);
  });
});
