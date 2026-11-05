import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { generateToken } from "@/lib/api-tokens";

// La cadena real — encabezado → token → tipo → SDK del MCP → herramientas —
// con la base y los encabezados simulados. La base simulada no tiene con qué
// escribir: si una herramienta lo intentara, fallaría.
const state = vi.hoisted(() => ({
  authorization: null as string | null,
  token: null as unknown,
  row: null as Record<string, unknown> | null,
  rows: [] as unknown[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null), isAllowedSession: () => false }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: { findUnique: vi.fn(async () => state.token), update: vi.fn(async () => ({})) },
    issue: {
      findMany: vi.fn(async () => state.rows),
      findUnique: vi.fn(async () => state.row),
    },
  },
}));

import { POST } from "./route";
import { prisma } from "@/lib/db";
import { resetRateLimits } from "@/lib/rate-limit";
import { mcpResource } from "@/lib/mcp-auth";

const MCP_URL = mcpResource();

const task = {
  id: "t-1",
  title: "Website tickets",
  category: "task",
  status: "in_progress",
  progress: 20,
  updated_at: new Date("2026-10-28T15:04:31Z"),
  description: "<p>Ship the <strong>pricing</strong> page.</p>",
};

/**
 * A token as the database has it. `oauth`: an access token theBook's OAuth
 * issued for the MCP (kind agent, audience the MCP's URL); otherwise one made
 * in Settings, with no audience.
 */
function withToken(kind: "agent" | "automation" | "mobile", { oauth = kind === "agent", audience = MCP_URL } = {}) {
  const { token, prefix, hash } = generateToken();
  state.authorization = `Bearer ${token}`;
  state.token = {
    id: `tok-${kind}`,
    name: "claude",
    kind,
    token_prefix: prefix,
    token_hash: hash,
    expires_at: null,
    revoked_at: null,
    ...(oauth ? { oauth_grant_id: "grant-1", audience } : { audience: null }),
  };
}

let nextId = 1;
function rpc(method: string, params: Record<string, unknown> = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params });
  return POST(
    new NextRequest("https://book.bolstro.com/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(state.authorization ? { authorization: state.authorization } : {}),
      },
      body,
    })
  );
}

/** The JSON-RPC message in a response: a JSON body, or the one event of an SSE stream (the 2025 protocol's). */
async function message(res: Response) {
  const text = await res.text();
  const data = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
  return JSON.parse(data);
}

/** Calls a tool and answers its result: the text, parsed when it is JSON, and whether it is an error. */
async function call(name: string, args: Record<string, unknown>) {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const json = await message(res);
  const result = json.result ?? { isError: true, content: [{ text: json.error?.message }] };
  const text: string = result.content[0].text;
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // a refusal's text
  }
  return { isError: result.isError === true, data, text };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  state.authorization = null;
  state.token = null;
  state.row = { ...task };
  state.rows = [];
});

describe("autenticación", () => {
  it("sin Bearer: 401 con el desafío que lleva a la metadata de OAuth", async () => {
    const res = await rpc("tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer realm="book", resource_metadata="${new URL(MCP_URL).origin}/.well-known/oauth-protected-resource/api/mcp", scope="issues"`
    );
  });

  it("un token inválido: 401 invalid_token", async () => {
    state.authorization = "Bearer tb_notarealtokenatallxxxxxxxxxxxxxxxxxxxxxxxxx";
    const res = await rpc("tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it.each(["automation", "mobile"] as const)("un token %s: 401, el MCP solo toma los tokens de su OAuth", async (kind) => {
    withToken(kind);
    const res = await rpc("tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("un token agent hecho en Settings (sin audiencia): 401", async () => {
    withToken("agent", { oauth: false });
    expect((await rpc("tools/list")).status).toBe(401);
  });

  it("un token de OAuth vencido o revocado: 401, y el cliente refresca", async () => {
    withToken("agent");
    state.token = { ...(state.token as object), expires_at: new Date(Date.now() - 1_000) };
    expect((await rpc("tools/list")).status).toBe(401);
    withToken("agent");
    state.token = { ...(state.token as object), revoked_at: new Date() };
    expect((await rpc("tools/list")).status).toBe(401);
  });

  it("un token de OAuth para otra audiencia: 401", async () => {
    withToken("agent", { audience: "https://evil.example/api/mcp" });
    expect((await rpc("tools/list")).status).toBe(401);
  });

  it("un cuerpo de más de 1 MiB: 413, sin leerlo entero", async () => {
    withToken("agent");
    const res = await POST(
      new NextRequest("https://book.bolstro.com/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: state.authorization! },
        body: "x".repeat(1024 * 1024 + 1),
      })
    );
    expect(res.status).toBe(413);
  });
});

describe("herramientas", () => {
  beforeEach(() => withToken("agent"));

  it("un batch de JSON-RPC: 400, sin ejecutar nada (cobraría una llamada por cien)", async () => {
    const one = { jsonrpc: "2.0", method: "tools/call", params: { name: "issues_list", arguments: {} } };
    const res = await POST(
      new NextRequest("https://book.bolstro.com/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: state.authorization! },
        body: JSON.stringify([{ ...one, id: 1 }, { ...one, id: 2 }]),
      })
    );
    expect(res.status).toBe(400);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it("un error inesperado sale como 500 sin su mensaje", async () => {
    vi.mocked(prisma.issue.findMany).mockRejectedValueOnce(new Error('Invalid `prisma.issue.findMany()` invocation: SELECT "secret"'));
    const r = await call("issues_list", {});
    expect(r).toMatchObject({ isError: true, text: "500: Internal error" });
  });

  it("un id que no es un id no llega a la base", async () => {
    const r = await call("issue_get", { id: "t-1\u0000" });
    expect(r.isError).toBe(true);
    expect(prisma.issue.findUnique).not.toHaveBeenCalled();
  });

  it("initialize y tools/list: dos herramientas, las dos de solo lectura", async () => {
    const init = await message(
      await rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      })
    );
    expect(init.result.serverInfo.name).toBe("thebook");

    const { result } = await message(await rpc("tools/list"));
    const tools = Object.fromEntries(result.tools.map((t: { name: string; annotations: unknown }) => [t.name, t.annotations]));
    expect(Object.keys(tools).sort()).toEqual(["issue_get", "issues_list"]);
    for (const annotations of Object.values(tools)) {
      expect(annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("issues_list: filas compactas, solo tareas, sin archivadas por defecto", async () => {
    state.rows = [{ id: "t-1", title: "Website tickets", status: "in_progress", progress: 20, updated_at: task.updated_at }];
    const { data } = await call("issues_list", {});
    expect(data).toEqual([{ id: "t-1", title: "Website tickets", status: "in_progress", progress: 20, updated: "2026-10-28T15:04Z" }]);
    expect(vi.mocked(prisma.issue.findMany).mock.calls[0][0]?.where).toEqual({ category: "task", status: { not: "done" } });

    await call("issues_list", { status: ["done"] });
    expect(vi.mocked(prisma.issue.findMany).mock.calls[1][0]?.where).toEqual({ category: "task", status: { in: ["done"] } });
  });

  it("issues_list: un estado que no existe es un error, sin consultar", async () => {
    const r = await call("issues_list", { status: ["waiting"] });
    expect(r.isError).toBe(true);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it("issue_get: la tarea y su descripción en markdown, nada más", async () => {
    const { data } = await call("issue_get", { id: "t-1" });
    expect(data).toEqual({
      id: "t-1",
      title: "Website tickets",
      status: "in_progress",
      progress: 20,
      updated: "2026-10-28T15:04Z",
      description: "Ship the **pricing** page.",
    });
  });

  it("issue_get: una nota de Brad no existe para el agente", async () => {
    state.row = { ...task, category: "note" };
    const r = await call("issue_get", { id: "t-1" });
    expect(r).toMatchObject({ isError: true, text: "404: Not found" });
  });

  it("issue_get: una tarea archivada se lee igual", async () => {
    state.row = { ...task, status: "done" };
    const { data } = await call("issue_get", { id: "t-1" });
    expect(data).toMatchObject({ id: "t-1", status: "done" });
  });
});
