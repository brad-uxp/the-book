import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { generateToken } from "@/lib/api-tokens";

// La cadena real — encabezado → token → tipo → SDK del MCP → herramientas →
// lib/issues-service.ts — con la base y los encabezados simulados.
const state = vi.hoisted(() => ({
  authorization: null as string | null,
  token: null as unknown,
  row: null as Record<string, unknown> | null,
  agentState: null as Record<string, unknown> | null,
  rows: [] as unknown[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null), isAllowedSession: () => false }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/db", () => {
  const matches = (where: Record<string, unknown>) =>
    state.row !== null &&
    Object.entries(where).every(([k, want]) =>
      want !== null && typeof want === "object" && "not" in want
        ? state.row![k] !== (want as { not: unknown }).not
        : state.row![k] === want
    );
  const db = {
    $queryRaw: vi.fn(async () => (state.row ? [{ title: state.row.title, category: state.row.category, status: state.row.status }] : [])),
    apiToken: { findUnique: vi.fn(async () => state.token), update: vi.fn(async () => ({})) },
    issue: {
      findMany: vi.fn(async () => state.rows),
      findUnique: vi.fn(async () => (state.row ? { ...state.row, agent_state: state.agentState } : null)),
      findUniqueOrThrow: vi.fn(async () => state.row),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(where)) return { count: 0 };
        state.row = { ...state.row, ...data };
        return { count: 1 };
      }),
    },
    issueAgentState: {
      findUnique: vi.fn(async () => state.agentState),
      upsert: vi.fn(async ({ update }: { update: Record<string, unknown> }) => {
        state.agentState = { ...(state.agentState ?? {}), ...update };
        return { work_dir: null, session_url: null, ...state.agentState };
      }),
    },
  };
  return { prisma: { ...db, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)) } };
});

import { POST } from "./route";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { resetRateLimits } from "@/lib/rate-limit";
import { agentBase } from "@/lib/issues-service";
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
  agent_note: "<p>🟡 Questions</p><p>1. A or B?</p>",
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
  state.agentState = null;
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
    const one = { jsonrpc: "2.0", method: "tools/call", params: { name: "issue_write_log", arguments: { id: "t-1", entry: "x" } } };
    const res = await POST(
      new NextRequest("https://book.bolstro.com/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: state.authorization! },
        body: JSON.stringify([{ ...one, id: 1 }, { ...one, id: 2 }]),
      })
    );
    expect(res.status).toBe(400);
    expect(prisma.issueAgentState.upsert).not.toHaveBeenCalled();
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

  it("initialize y tools/list: las cinco, con sus anotaciones", async () => {
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
    expect(Object.keys(tools).sort()).toEqual(["issue_get", "issue_update_note", "issue_update_state", "issue_write_log", "issues_list"]);
    expect(tools.issues_list).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools.issue_get).toMatchObject({ readOnlyHint: true });
    expect(tools.issue_update_note).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.issue_write_log).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it("issues_list: filas compactas, solo tareas, sin archivadas por defecto", async () => {
    state.rows = [{ id: "t-1", title: "Website tickets", status: "in_progress", progress: 20, updated_at: task.updated_at }];
    const { data } = await call("issues_list", {});
    expect(data).toEqual([{ id: "t-1", title: "Website tickets", status: "in_progress", progress: 20, updated: "2026-10-28T15:04Z" }]);
    expect(vi.mocked(prisma.issue.findMany).mock.calls[0][0]?.where).toEqual({ category: "task", status: { not: "done" } });

    await call("issues_list", { status: ["done"] });
    expect(vi.mocked(prisma.issue.findMany).mock.calls[1][0]?.where).toEqual({ category: "task", status: { in: ["done"] } });
  });

  it("issue_get: markdown, lo que cambió Brad desde la última nota y la versión base", async () => {
    state.agentState = {
      log: "[2026-10-27 10:00] one\n[2026-10-28 11:00] two",
      last_note: "<p>🟡 Questions</p>",
      description_seen: "<p>Ship the <strong>pricing</strong> page.</p>",
      work_dir: "/Users/me/web",
      session_url: null,
    };
    const { data } = await call("issue_get", { id: "t-1", log_lines: 1 });
    expect(data).toEqual({
      id: "t-1",
      title: "Website tickets",
      status: "in_progress",
      progress: 20,
      updated: "2026-10-28T15:04Z",
      description: "Ship the **pricing** page.",
      note: "🟡 Questions\n\n1. A or B?",
      changes: { note: "@@ -1,1 +1,3 @@\n 🟡 Questions\n+\n+1. A or B?" },
      base: agentBase(task),
      work_dir: "/Users/me/web",
      log: "[2026-10-28 11:00] two",
    });
    expect(JSON.stringify(data)).not.toContain("<p>");
  });

  it("issue_get: una nota de Brad no existe para el agente", async () => {
    state.row = { ...task, category: "note" };
    const r = await call("issue_get", { id: "t-1" });
    expect(r).toMatchObject({ isError: true, text: "404: Not found" });
  });

  it.each(["done", "pending"])("issue_update_state(status=%s): error claro, sin escribir", async (status) => {
    const r = await call("issue_update_state", { id: "t-1", status });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("done and pending are Brad's");
    expect(prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it("issue_update_state: estado, progreso y carpeta en una sola escritura", async () => {
    const r = await call("issue_update_state", { id: "t-1", status: "review", progress: 90, work_dir: "/Users/me/web" });
    expect(r).toMatchObject({ isError: false, data: { ok: true } });
    expect(state.row).toMatchObject({ status: "review", progress: 90 });
    expect(state.agentState).toMatchObject({ work_dir: "/Users/me/web" });
  });

  it("issue_update_state: un link de sesión que no es http(s) no pasa", async () => {
    const r = await call("issue_update_state", { id: "t-1", session_url: "javascript:alert(1)" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^400:/);
  });

  it("issue_update_note: escribe HTML desde markdown y devuelve la nueva base", async () => {
    const r = await call("issue_update_note", { id: "t-1", note: "✅ Ready\n\nSee **PR 12**. @Ana", base: agentBase(task) });
    expect(r.isError).toBe(false);
    expect(state.row!.agent_note).toBe("<p>✅ Ready</p><p>See <strong>PR 12</strong>. @Ana</p>");
    expect(r.data).toEqual({ base: agentBase(state.row as typeof task) });
    // La auditoría registra al token agent y qué campo cambió.
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({
      actor_email: expect.stringMatching(/^token:agent:claude \(tb_/),
      after: expect.objectContaining({ changed: ["agent_note"] }),
    });
  });

  it("issue_update_note: con una versión base vieja, 409 y nada escrito", async () => {
    const r = await call("issue_update_note", { id: "t-1", note: "mine", base: agentBase({ ...task, agent_note: "" }) });
    expect(r).toMatchObject({ isError: true, text: "409: The note or the description changed since you read it" });
    expect(state.row!.agent_note).toBe(task.agent_note);
  });

  it("issue_update_note: en una tarea archivada o en una nota, 403", async () => {
    state.row = { ...task, status: "done" };
    expect(await call("issue_update_note", { id: "t-1", note: "x", base: agentBase(task) })).toMatchObject({
      isError: true,
      text: "403: This issue is archived; only the owner can reopen it",
    });
    state.row = { ...task, category: "note" };
    expect(await call("issue_update_note", { id: "t-1", note: "x", base: agentBase(task) })).toMatchObject({
      isError: true,
      text: "403: An agent works tasks, not notes",
    });
    expect(prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it("issue_write_log: agrega en el servidor, no reemplaza", async () => {
    state.agentState = { log: "[2026-10-27 10:00] earlier" };
    const r = await call("issue_write_log", { id: "t-1", entry: "opened PR 12" });
    expect(r).toMatchObject({ isError: false, data: { ok: true } });
    expect(state.agentState!.log).toMatch(/^\[2026-10-27 10:00\] earlier\n\[\d{4}-\d\d-\d\d \d\d:\d\d\] opened PR 12$/);
  });

  it("issue_write_log: en una tarea archivada, 403", async () => {
    state.row = { ...task, status: "done" };
    expect(await call("issue_write_log", { id: "t-1", entry: "x" })).toMatchObject({ isError: true, text: expect.stringMatching(/^403:/) });
    expect(prisma.issueAgentState.upsert).not.toHaveBeenCalled();
  });
});
