import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn() }));

import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import {
  createIssue,
  deleteIssue,
  inTransaction,
  pickSent,
  updateAgentState,
  updateIssue,
  type Db,
  type WriteContext,
} from "./issues-service";

const before = {
  id: "i1",
  title: "Pricing",
  client_id: "c1",
  category: "note",
  note_format: "text",
  status: "pending",
  progress: 0,
  due_date: null,
  description: "<p>what it said</p>",
  agent_note: "",
  sort_order: 0,
};

function fakeDb() {
  return {
    issue: {
      findUnique: vi.fn(async () => before),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...before, ...data, id: data.id ?? "new" })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...before, ...data })),
      delete: vi.fn(async () => before),
    },
    canvasNode: { create: vi.fn() },
    issueAgentState: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ work_dir: null, session_url: null, ...create })),
    },
  };
}

let audits: unknown[];
let ctx: WriteContext;
beforeEach(() => {
  vi.clearAllMocks();
  audits = [];
  ctx = { actor: "token:mobile", access: "owner", audit: (e) => audits.push(e) };
});

describe("pickSent", () => {
  it("solo las claves que el cliente mandó, con su valor parseado", () => {
    const parsed = { title: "t", status: "pending", category: "task", client_id: null };
    expect(pickSent({ title: " t", client_id: null, unknown: 1 }, parsed)).toEqual({ title: "t", client_id: null });
    expect(pickSent(null, parsed)).toEqual({});
  });
});

describe("createIssue", () => {
  it("acepta el id del cliente y audita como quien escribe", async () => {
    const db = fakeDb();
    const r = await createIssue(db as unknown as Db, { id: "u-1", title: "N", category: "note" }, ctx);
    expect(r.ok).toBe(true);
    expect(db.issue.create.mock.calls[0][0].data).toMatchObject({ id: "u-1", title: "N", category: "note", note_format: "text", status: "pending" });
    expect(audits).toEqual([expect.objectContaining({ action: "create", entity_id: "u-1", actor_email: "token:mobile" })]);
  });

  it("una task canvas no existe", async () => {
    const db = fakeDb();
    const r = await createIssue(db as unknown as Db, { title: "N", category: "task", note_format: "canvas" }, ctx);
    expect(r).toEqual({ ok: false, status: 400, error: "Only a note can be a canvas" });
    expect(db.issue.create).not.toHaveBeenCalled();
  });
});

describe("updateIssue", () => {
  it("escribe solo lo que vino: editar el texto no toca el estado", async () => {
    const db = fakeDb();
    await updateIssue(db as unknown as Db, "i1", { description: "<p>new</p>" }, ctx);
    expect(db.issue.update.mock.calls[0][0].data).toEqual({ description: "<p>new</p>" });
  });

  it("client_id null desconecta; un id conecta", async () => {
    const db = fakeDb();
    await updateIssue(db as unknown as Db, "i1", { client_id: null }, ctx);
    await updateIssue(db as unknown as Db, "i1", { client_id: "c2" }, ctx);
    expect(db.issue.update.mock.calls[0][0].data).toEqual({ client: { disconnect: true } });
    expect(db.issue.update.mock.calls[1][0].data).toEqual({ client: { connect: { id: "c2" } } });
  });

  it("nota de texto → canvas: el texto pasa a la primera idea y la descripción se vacía", async () => {
    const db = fakeDb();
    await updateIssue(db as unknown as Db, "i1", { note_format: "canvas" }, ctx);
    expect(db.issue.update.mock.calls[0][0].data).toEqual({ note_format: "canvas", description: "" });
    expect(db.canvasNode.create.mock.calls[0][0].data).toMatchObject({ issue_id: "i1", content: "<p>what it said</p>" });
  });

  it("un canvas no vuelve a texto (409) y una fila que no existe es 404", async () => {
    const db = fakeDb();
    db.issue.findUnique.mockResolvedValueOnce({ ...before, note_format: "canvas" });
    expect(await updateIssue(db as unknown as Db, "i1", { note_format: "text" }, ctx)).toMatchObject({ ok: false, status: 409 });
    db.issue.findUnique.mockResolvedValueOnce(null as never);
    expect(await updateIssue(db as unknown as Db, "nope", { title: "x" }, ctx)).toMatchObject({ ok: false, status: 404 });
    expect(db.issue.update).not.toHaveBeenCalled();
  });
});

describe("updateIssue: agent_note del dueño", () => {
  it("el dueño responde en la nota sin tocar lo que guardó el agente", async () => {
    const db = fakeDb();
    expect((await updateIssue(db as unknown as Db, "i1", { agent_note: "<p>go with A</p>" }, ctx)).ok).toBe(true);
    expect(db.issue.update.mock.calls[0][0].data).toEqual({ agent_note: "<p>go with A</p>" });
    expect(db.issueAgentState.upsert).not.toHaveBeenCalled();
  });

  it("el dueño sí archiva", async () => {
    const db = fakeDb();
    expect((await updateIssue(db as unknown as Db, "i1", { status: "done" }, ctx)).ok).toBe(true);
  });
});

describe("deleteIssue", () => {
  it("audita lo que borró; lo que no existe es 404", async () => {
    const db = fakeDb();
    expect((await deleteIssue(db as unknown as Db, "i1", ctx)).ok).toBe(true);
    expect(audits).toEqual([expect.objectContaining({ action: "delete", entity_name: "Pricing" })]);
    db.issue.findUnique.mockResolvedValueOnce(null as never);
    expect(await deleteIssue(db as unknown as Db, "nope", ctx)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("inTransaction", () => {
  it("escribe la auditoría solo después del commit", async () => {
    const db = fakeDb();
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: unknown) => unknown) => fn(db)) as never);
    await inTransaction({ actor: "me", access: "owner" }, (tx, c) => deleteIssue(tx, "i1", c));
    expect(auditLog).toHaveBeenCalledTimes(1);

    vi.mocked(auditLog).mockClear();
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: unknown) => unknown) => {
      await fn(db);
      throw new Error("rolled back");
    }) as never);
    await expect(inTransaction({ actor: "me", access: "owner" }, (tx, c) => deleteIssue(tx, "i1", c))).rejects.toThrow("rolled back");
    expect(auditLog).not.toHaveBeenCalled();
  });
});

// Un token `agent` trabaja una épica, no es su dueño: lo garantiza el servicio,
// no el prompt del agente. Cada caso prohibido es un 403 y no escribe nada.
describe("actor agent", () => {
  const task = { ...before, category: "task", status: "in_progress" };
  let agent: WriteContext;
  beforeEach(() => {
    agent = { actor: "token:claude-agent", access: "agent", audit: (e) => audits.push(e) };
  });

  function taskDb(row: Record<string, unknown> = task) {
    const db = fakeDb();
    db.issue.findUnique.mockResolvedValue(row as never);
    return db;
  }

  describe("puede", () => {
    it("escribir su nota; el servidor guarda la nota y la descripción que vio", async () => {
      const db = taskDb();
      const r = await updateIssue(db as unknown as Db, "i1", { agent_note: "<p>✅ Ready</p>" }, agent);
      expect(r.ok).toBe(true);
      expect(db.issue.update.mock.calls[0][0].data).toEqual({ agent_note: "<p>✅ Ready</p>" });
      expect(db.issueAgentState.upsert.mock.calls[0][0]).toEqual({
        where: { issue_id: "i1" },
        create: { issue_id: "i1", last_note: "<p>✅ Ready</p>", description_seen: "<p>what it said</p>" },
        update: { last_note: "<p>✅ Ready</p>", description_seen: "<p>what it said</p>" },
      });
      expect(audits).toEqual([expect.objectContaining({ action: "update", actor_email: "token:claude-agent" })]);
    });

    it("mover el progreso", async () => {
      const db = taskDb();
      expect((await updateIssue(db as unknown as Db, "i1", { progress: 60 }, agent)).ok).toBe(true);
      expect(db.issue.update.mock.calls[0][0].data).toEqual({ progress: 60 });
      expect(db.issueAgentState.upsert).not.toHaveBeenCalled();
    });

    it.each(["in_progress", "review", "blocked"] as const)("pasar a %s", async (status) => {
      const db = taskDb();
      expect((await updateIssue(db as unknown as Db, "i1", { status }, agent)).ok).toBe(true);
      expect(db.issue.update.mock.calls[0][0].data).toEqual({ status });
    });

    it("entregar de una vez: nota, progreso y review", async () => {
      const db = taskDb();
      const patch = { agent_note: "<p>🟡 Questions</p>", progress: 80, status: "review" as const };
      expect((await updateIssue(db as unknown as Db, "i1", patch, agent)).ok).toBe(true);
      expect(db.issue.update.mock.calls[0][0].data).toEqual(patch);
    });

    it("escribir su bitácora, carpeta y sesión — solo lo que mandó, sin texto en la auditoría", async () => {
      const db = taskDb();
      const r = await updateAgentState(db as unknown as Db, "i1", { log: "- read the brief", work_dir: "/Users/me/web" }, agent);
      expect(r.ok).toBe(true);
      expect(db.issueAgentState.upsert.mock.calls[0][0]).toEqual({
        where: { issue_id: "i1" },
        create: { issue_id: "i1", log: "- read the brief", work_dir: "/Users/me/web" },
        update: { log: "- read the brief", work_dir: "/Users/me/web" },
      });
      expect(JSON.stringify(audits)).not.toContain("read the brief");
      expect(audits).toEqual([expect.objectContaining({ entity_id: "i1", actor_email: "token:claude-agent" })]);
    });
  });

  describe("no puede (403, sin escribir nada)", () => {
    it("marcar done: solo el dueño archiva", async () => {
      const db = taskDb();
      const r = await updateIssue(db as unknown as Db, "i1", { status: "done" }, agent);
      expect(r).toEqual({ ok: false, status: 403, error: "Only the owner can mark an issue done" });
      expect(db.issue.update).not.toHaveBeenCalled();
    });

    it("devolver al backlog", async () => {
      const db = taskDb();
      expect(await updateIssue(db as unknown as Db, "i1", { status: "pending" }, agent)).toMatchObject({ ok: false, status: 403 });
      expect(db.issue.update).not.toHaveBeenCalled();
    });

    it.each([
      ["el título", { title: "Renamed" }],
      ["la descripción", { description: "<p>rewritten</p>" }],
      ["la fecha", { due_date: "2026-12-01" }],
      ["la categoría", { category: "note" }],
      ["el cliente", { client_id: "c2" }],
      ["el cliente (quitarlo)", { client_id: null }],
      ["el formato", { note_format: "canvas" }],
      ["el orden", { sort_order: 3 }],
    ] as const)("tocar %s", async (_label, patch) => {
      const db = taskDb();
      const r = await updateIssue(db as unknown as Db, "i1", patch, agent);
      expect(r).toMatchObject({ ok: false, status: 403 });
      expect(db.issue.update).not.toHaveBeenCalled();
      expect(db.canvasNode.create).not.toHaveBeenCalled();
      expect(audits).toEqual([]);
    });

    it("colar un campo ajeno junto a los suyos", async () => {
      const db = taskDb();
      const r = await updateIssue(db as unknown as Db, "i1", { agent_note: "<p>hi</p>", description: "<p>mine now</p>" }, agent);
      expect(r).toEqual({ ok: false, status: 403, error: "An agent cannot change description" });
      expect(db.issue.update).not.toHaveBeenCalled();
      expect(db.issueAgentState.upsert).not.toHaveBeenCalled();
    });

    it("crear", async () => {
      const db = taskDb();
      const r = await createIssue(db as unknown as Db, { title: "New epic" }, agent);
      expect(r).toEqual({ ok: false, status: 403, error: "An agent cannot create issues" });
      expect(db.issue.create).not.toHaveBeenCalled();
    });

    it("borrar", async () => {
      const db = taskDb();
      const r = await deleteIssue(db as unknown as Db, "i1", agent);
      expect(r).toEqual({ ok: false, status: 403, error: "An agent cannot delete issues" });
      expect(db.issue.delete).not.toHaveBeenCalled();
      expect(audits).toEqual([]);
    });

    it("escribir en una nota: las notas son de Brad", async () => {
      const db = taskDb({ ...before, category: "note" });
      expect(await updateIssue(db as unknown as Db, "i1", { agent_note: "<p>hi</p>" }, agent)).toEqual({
        ok: false,
        status: 403,
        error: "An agent works tasks, not notes",
      });
      expect(await updateAgentState(db as unknown as Db, "i1", { log: "x" }, agent)).toMatchObject({ ok: false, status: 403 });
      expect(db.issue.update).not.toHaveBeenCalled();
      expect(db.issueAgentState.upsert).not.toHaveBeenCalled();
    });

    it("reabrir ni escribir una épica archivada", async () => {
      const db = taskDb({ ...task, status: "done" });
      expect(await updateIssue(db as unknown as Db, "i1", { status: "in_progress" }, agent)).toMatchObject({ ok: false, status: 403 });
      expect(await updateIssue(db as unknown as Db, "i1", { agent_note: "<p>more</p>" }, agent)).toMatchObject({ ok: false, status: 403 });
      expect(await updateAgentState(db as unknown as Db, "i1", { log: "x" }, agent)).toMatchObject({ ok: false, status: 403 });
      expect(db.issue.update).not.toHaveBeenCalled();
      expect(db.issueAgentState.upsert).not.toHaveBeenCalled();
    });
  });

  it("una épica que no existe es 404", async () => {
    const db = taskDb(null as never);
    expect(await updateIssue(db as unknown as Db, "nope", { progress: 10 }, agent)).toMatchObject({ ok: false, status: 404 });
    expect(await updateAgentState(db as unknown as Db, "nope", { log: "x" }, agent)).toMatchObject({ ok: false, status: 404 });
  });

  it("el dueño también puede escribir el estado del agente", async () => {
    const db = taskDb({ ...task, status: "done" });
    expect((await updateAgentState(db as unknown as Db, "i1", { work_dir: null }, ctx)).ok).toBe(true);
  });
});
