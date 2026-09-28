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
  };
}

let audits: unknown[];
let ctx: WriteContext;
beforeEach(() => {
  vi.clearAllMocks();
  audits = [];
  ctx = { actor: "token:mobile", audit: (e) => audits.push(e) };
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
    await inTransaction("me", (tx, c) => deleteIssue(tx, "i1", c));
    expect(auditLog).toHaveBeenCalledTimes(1);

    vi.mocked(auditLog).mockClear();
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: unknown) => unknown) => {
      await fn(db);
      throw new Error("rolled back");
    }) as never);
    await expect(inTransaction("me", (tx, c) => deleteIssue(tx, "i1", c))).rejects.toThrow("rolled back");
    expect(auditLog).not.toHaveBeenCalled();
  });
});
