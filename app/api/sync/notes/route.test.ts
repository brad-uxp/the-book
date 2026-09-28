import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// The database is faked; the route, the push loop, the rules and the
// validation are the real code. End-to-end runs against Postgres are in the
// phase 2 verification notes (docs/product/mobile-app.md).
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    syncMutation: { findUnique: vi.fn(), create: vi.fn() },
    issue: { findUnique: vi.fn() },
    canvasNode: { findUnique: vi.fn() },
    canvasEdge: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn(), getActorEmail: vi.fn(async () => "token:mobile · Pixel") }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireSyncSession: vi.fn(),
  resolveActor: vi.fn(async () => ({ kind: "token", id: "tok-phone", label: "token:mobile · Pixel", tokenKind: "mobile" })),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { GET, POST } from "./route";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { requireSyncSession } from "@/lib/api";
import { SYNC_MUTATIONS_PER_MINUTE, SYNC_PAGE_LIMITS, encodeCursor, mutationPayloadHash } from "@/lib/sync";
import { resetRateLimits } from "@/lib/rate-limit";

const tx = vi.mocked(prisma.$transaction);
const stored = vi.mocked(prisma.syncMutation.findUnique);
const record = vi.mocked(prisma.syncMutation.create);

const MID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ID = "11111111-1111-4111-8111-111111111111";

function push(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/sync/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

const pull = (since?: string) =>
  GET(new NextRequest(`http://localhost/api/sync/notes${since ? `?since=${since}` : ""}`));

const issueRow = (id: string, updated: string) => ({
  id,
  title: "t",
  client_id: null,
  category: "note" as const,
  note_format: "text" as const,
  status: "pending" as const,
  progress: 0,
  due_date: null,
  description: "",
  sort_order: 0,
  created_at: new Date(updated),
  updated_at: new Date(updated),
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.mocked(requireSyncSession).mockResolvedValue(null);
  stored.mockResolvedValue(null);
  record.mockResolvedValue({} as never);
});

describe("auth", () => {
  it("sin credencial, ni pull ni push tocan la base", async () => {
    vi.mocked(requireSyncSession).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await pull()).status).toBe(401);
    expect((await push({ mutations: [{ mutation_id: MID(1) }] })).status).toBe(401);
    expect(tx).not.toHaveBeenCalled();
    expect(stored).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync/notes — el cuerpo", () => {
  it("JSON roto → 400; vacío → 400; más de 200 cambios → 400", async () => {
    expect((await push("{nope")).status).toBe(400);
    expect((await push({ mutations: [] })).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({ mutation_id: MID(i) }));
    expect((await push({ mutations: many })).status).toBe(400);
    expect(tx).not.toHaveBeenCalled();
  });

  it("más de 5 MB → 413, antes de parsear", async () => {
    const res = await push({ mutations: [{ mutation_id: MID(1), pad: "x".repeat(5 * 1024 * 1024) }] });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/sync/notes — idempotencia y orden", () => {
  it("un cambio ya procesado devuelve la respuesta guardada sin aplicarse de nuevo", async () => {
    const first = { mutation_id: MID(1), status: "applied", row: null };
    stored.mockResolvedValue({ mutation_id: MID(1), result: first, created_at: new Date() } as never);
    const res = await push({ mutations: [{ mutation_id: MID(1), entity: "issue", op: "delete", id: ID }] });
    expect(await res.json()).toEqual({ results: [first] });
    expect(tx).not.toHaveBeenCalled();
  });

  it("dos reintentos a la vez: el que pierde la carrera devuelve la respuesta del primero", async () => {
    const first = { mutation_id: MID(1), status: "applied", row: null };
    stored.mockResolvedValueOnce(null).mockResolvedValueOnce({ result: first } as never);
    tx.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002", meta: { modelName: "SyncMutation", target: ["mutation_id"] } }));
    const res = await push({ mutations: [{ mutation_id: MID(1), entity: "issue", op: "delete", id: ID }] });
    expect((await res.json()).results).toEqual([first]);
  });

  it("un cambio malformado se rechaza solo, y se guarda esa respuesta", async () => {
    tx.mockImplementation((async (fn: (t: unknown) => unknown) =>
      fn({
        $queryRaw: vi.fn(async () => []),
        syncMutation: { create: vi.fn(), update: vi.fn() },
        issue: { findUnique: vi.fn(async () => null) },
      })) as never);
    const res = await push({
      mutations: [
        { mutation_id: MID(1), entity: "user", op: "upsert", id: ID },
        { mutation_id: MID(2), entity: "issue", op: "delete", id: ID },
      ],
    });
    const { results } = await res.json();
    expect(results).toEqual([
      { mutation_id: MID(1), status: "rejected", reason: "invalid" },
      { mutation_id: MID(2), status: "applied", reason: "already_deleted", row: null },
    ]);
    // Se guarda el veredicto, nunca la fila.
    expect(record).toHaveBeenCalledWith({
      data: { mutation_id: MID(1), payload_hash: expect.stringMatching(/^[0-9a-f]{64}$/), result: { status: "rejected", reason: "invalid" } },
    });
  });

  it("el mismo id con otro contenido se rechaza: no es un reintento, y no recibe la respuesta del primero", async () => {
    const first = { mutation_id: MID(1), entity: "issue", op: "delete", id: ID };
    stored.mockResolvedValue({ result: { status: "applied" }, payload_hash: mutationPayloadHash(first) } as never);
    const res = await push({ mutations: [{ ...first, op: "upsert", fields: { title: "otra cosa" } }] });
    expect((await res.json()).results).toEqual([{ mutation_id: MID(1), status: "rejected", reason: "mutation_id_reused" }]);
    expect(tx).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    // El reintento de verdad sigue recibiendo su respuesta.
    const again = await push({ mutations: [first] });
    expect((await again.json()).results[0]).toMatchObject({ status: "applied" });
  });

  it("una respuesta guardada antes del hash (sin payload_hash) se sigue reenviando", async () => {
    stored.mockResolvedValue({ result: { status: "applied" }, payload_hash: null } as never);
    const res = await push({ mutations: [{ mutation_id: MID(1), entity: "issue", op: "delete", id: ID }] });
    expect((await res.json()).results[0]).toMatchObject({ status: "applied" });
  });

  it("lo guardado es solo el veredicto; un reintento reconstruye la fila desde la base", async () => {
    const now = issueRow(ID, "2026-09-28T12:00:00Z");
    // Una respuesta guardada antes de este cambio, con una fila vieja adentro: no se reenvía.
    stored.mockResolvedValue({ result: { mutation_id: MID(1), status: "applied", row: { id: ID, title: "viejo" } } } as never);
    vi.mocked(prisma.issue.findUnique).mockResolvedValueOnce(now as never);
    const res = await push({ mutations: [{ mutation_id: MID(1), entity: "issue", op: "upsert", id: ID, fields: { title: "t" } }] });
    const [result] = (await res.json()).results;
    expect(result).toMatchObject({ mutation_id: MID(1), status: "applied", row: { id: ID, updated_at: "2026-09-28T12:00:00.000Z" } });
    expect(result.row.title).toBe("t");
    expect(tx).not.toHaveBeenCalled();
  });

  it("al aplicar, la respuesta lleva la fila pero la base guarda solo el veredicto", async () => {
    const before = { ...issueRow(ID, "2026-09-28T10:00:00Z"), description: "<p>largo</p>" };
    const update = vi.fn();
    tx.mockImplementation((async (fn: (t: unknown) => unknown) =>
      fn({
        $queryRaw: vi.fn(async () => []),
        syncMutation: { create: vi.fn(), update },
        issue: { findUnique: vi.fn(async () => before) },
      })) as never);
    const res = await push({ mutations: [{ mutation_id: MID(1), entity: "issue", op: "upsert", id: ID, base_updated_at: "2026-09-28T10:00:00Z", fields: {} }] });
    const [result] = (await res.json()).results;
    expect(result.row.description).toBe("<p>largo</p>");
    expect(update).toHaveBeenCalledWith({ where: { mutation_id: MID(1) }, data: { result: { status: "applied" } } });
  });

  it("lo que la base rechaza (P2003) es la respuesta de ese cambio, no un 500", async () => {
    tx.mockRejectedValue(Object.assign(new Error("fk"), { code: "P2003" }));
    const res = await push({ mutations: [{ mutation_id: MID(1), entity: "issue", op: "delete", id: ID }] });
    expect((await res.json()).results).toEqual([
      { mutation_id: MID(1), status: "rejected", reason: "reference_missing", row: null },
    ]);
  });

  it("un error inesperado corta el push: lo que sigue queda sin respuesta, para reenviarse en orden", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    tx.mockRejectedValueOnce(new Error("connection reset"));
    const res = await push({
      mutations: [
        { mutation_id: MID(1), entity: "issue", op: "delete", id: ID },
        { mutation_id: MID(2), entity: "issue", op: "delete", id: ID },
      ],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual([]);
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it("un cambio que falla por sí mismo se responde server_error y el push sigue: la cola del teléfono no se atasca", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const row = issueRow(ID, "2026-09-28T10:00:00Z");
    vi.mocked(prisma.issue.findUnique).mockResolvedValueOnce(row as never);
    tx.mockRejectedValueOnce(
      Object.assign(new Error("invalid byte sequence for encoding UTF8: 0x00"), {
        name: "PrismaClientKnownRequestError",
        code: "P2010",
        meta: { driverAdapterError: { cause: { kind: "postgres", code: "22021" } } },
      })
    );
    tx.mockImplementationOnce((async (fn: (t: unknown) => unknown) =>
      fn({ $queryRaw: vi.fn(async () => []),
        syncMutation: { create: vi.fn(), update: vi.fn() }, issue: { findUnique: vi.fn(async () => null) } })) as never);
    const res = await push({
      mutations: [
        { mutation_id: MID(1), entity: "issue", op: "upsert", id: ID, fields: { title: "t" } },
        { mutation_id: MID(2), entity: "issue", op: "delete", id: ID },
      ],
    });
    const { results, more } = await res.json();
    expect(more).toBeUndefined();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ mutation_id: MID(1), status: "rejected", reason: "server_error", row: { id: ID } });
    expect(results[1]).toMatchObject({ mutation_id: MID(2), status: "applied" });
    // Queda guardado: un reintento recibe lo mismo en vez de volver a fallar.
    expect(record).toHaveBeenCalledWith({
      data: { mutation_id: MID(1), payload_hash: expect.any(String), result: { status: "rejected", reason: "server_error" } },
    });
  });

  it("la auditoría se escribe después del commit, nunca por un cambio deshecho", async () => {
    const before = issueRow(ID, "2026-09-28T10:00:00Z");
    tx.mockImplementation((async (fn: (t: unknown) => Promise<unknown>) => {
      await fn({
        $queryRaw: vi.fn(async () => []),
        syncMutation: { create: vi.fn(), update: vi.fn() },
        issue: { findUnique: vi.fn(async () => before), delete: vi.fn() },
      });
      throw new Error("commit failed");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await push({ mutations: [{ mutation_id: MID(1), entity: "issue", op: "delete", id: ID }] });
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync/notes — el texto se juzga con la fila bloqueada", () => {
  it.each([
    ["editar una nota", { entity: "issue", op: "upsert", fields: { description: "<p>x</p>" }, base_hash: "a".repeat(64) }, "Task"],
    ["borrar una nota", { entity: "issue", op: "delete" }, "Task"],
    ["editar una idea", { entity: "canvas_node", op: "upsert", fields: { content: "<p>x</p>" }, base_hash: "a".repeat(64) }, "CanvasNode"],
    ["borrar una idea", { entity: "canvas_node", op: "delete" }, "CanvasNode"],
  ])("%s: FOR UPDATE antes de leer, en la misma transacción", async (_label, change, table) => {
    const order: string[] = [];
    tx.mockImplementation((async (fn: (t: unknown) => unknown) =>
      fn({
        $queryRaw: vi.fn(async (sql: TemplateStringsArray) => {
          order.push(`lock:${sql.join("?").match(/FROM "(\w+)"/)?.[1]}:${/FOR UPDATE/.test(sql.join("")) ? "for-update" : "?"}`);
          return [];
        }),
        syncMutation: { create: vi.fn(), update: vi.fn() },
        issue: { findUnique: vi.fn(async () => (order.push("read"), null)) },
        canvasNode: { findUnique: vi.fn(async () => (order.push("read"), null)) },
      })) as never);
    await push({ mutations: [{ mutation_id: MID(1), id: ID, base_updated_at: "2026-09-28T10:00:00Z", ...change }] });
    expect(order.slice(0, 2)).toEqual([`lock:${table}:for-update`, "read"]);
  });
});

describe("POST /api/sync/notes — presupuesto de un push", () => {
  const upserts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      mutation_id: MID(i + 1),
      entity: "issue",
      op: "upsert",
      id: ID,
      base_updated_at: "2026-09-28T10:00:00Z",
      fields: {},
    }));

  function rowsOf(description: string) {
    const row = { ...issueRow(ID, "2026-09-28T10:00:00Z"), description };
    tx.mockImplementation((async (fn: (t: unknown) => unknown) =>
      fn({ $queryRaw: vi.fn(async () => []),
        syncMutation: { create: vi.fn(), update: vi.fn() }, issue: { findUnique: vi.fn(async () => row) } })) as never);
  }

  it("corta cuando la respuesta pasa de unos megas y avisa con more: el resto se manda enseguida", async () => {
    rowsOf("x".repeat(1_500_000));
    const body = await (await push({ mutations: upserts(5) })).json();
    expect(body.more).toBe(true);
    expect(body.results).toHaveLength(3); // 3 × 1,5 MB pasan los 4 MB
    expect(tx).toHaveBeenCalledTimes(3);
  });

  it("corta por tiempo (~10 s) y avisa con more", async () => {
    rowsOf("<p>corto</p>");
    let clock = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => (clock += 6000));
    try {
      const body = await (await push({ mutations: upserts(5) })).json();
      expect(body.more).toBe(true);
      expect(body.results).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it("un push que termina completo no lleva more; uno que se cortó por un fallo tampoco", async () => {
    rowsOf("<p>corto</p>");
    expect(await (await push({ mutations: upserts(3) })).json()).not.toHaveProperty("more");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    tx.mockRejectedValueOnce(Object.assign(new Error("Can't reach database server"), { code: "P1001" }));
    const body = await (await push({ mutations: upserts(2) })).json();
    expect(body).toEqual({ results: [] });
  });
});

describe("POST /api/sync/notes — costo", () => {
  const deletes = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => ({ mutation_id: MID(from + i), entity: "issue", op: "delete", id: ID }));

  beforeEach(() => {
    tx.mockImplementation((async (fn: (t: unknown) => unknown) =>
      fn({ $queryRaw: vi.fn(async () => []),
        syncMutation: { create: vi.fn(), update: vi.fn() }, issue: { findUnique: vi.fn(async () => null) } })) as never);
  });

  it("se cobra por cambio: pasado el presupuesto del minuto, 429 con Retry-After y sin tocar la base", async () => {
    const pushes = SYNC_MUTATIONS_PER_MINUTE / 200;
    for (let i = 0; i < pushes; i++) {
      expect((await push({ mutations: deletes(200, i * 200 + 1) })).status).toBe(200);
    }
    tx.mockClear();
    const res = await push({ mutations: deletes(1, 5000) });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(tx).not.toHaveBeenCalled();
  });

  it("dos pushes del mismo token no corren a la vez", async () => {
    let running = 0;
    let most = 0;
    tx.mockImplementation((async (fn: (t: unknown) => unknown) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      const out = await fn({ $queryRaw: vi.fn(async () => []),
        syncMutation: { create: vi.fn(), update: vi.fn() }, issue: { findUnique: vi.fn(async () => null) } });
      running -= 1;
      return out;
    }) as never);
    await Promise.all([push({ mutations: deletes(3, 1) }), push({ mutations: deletes(3, 10) })]);
    expect(most).toBe(1);
  });
});

describe("GET /api/sync/notes", () => {
  function fakeTx(rows: { issues?: unknown[]; tombstones?: unknown[]; alive?: string[] }) {
    const t = {
      issue: {
        findMany: vi.fn(async (args: { select?: { id: true; title?: true } }) =>
          args.select && !args.select.title ? (rows.alive ?? []).map((id) => ({ id })) : (rows.issues ?? [])
        ),
      },
      canvasNode: { findMany: vi.fn(async () => []) },
      canvasEdge: { findMany: vi.fn(async () => []) },
      syncTombstone: { findMany: vi.fn(async () => rows.tombstones ?? []) },
    };
    tx.mockImplementation((async (fn: (x: unknown) => unknown) => fn(t)) as never);
    return t;
  }

  it("sin cursor: sync completa, sin leer borrados, cursor = inicio de la ronda", async () => {
    const t = fakeTx({ issues: [issueRow(ID, "2026-09-28T10:00:00Z")] });
    const res = await pull();
    const body = await res.json();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ reset: false, has_more: false, tombstones: [] });
    expect(body.issues[0]).toMatchObject({ id: ID, updated_at: "2026-09-28T10:00:00.000Z" });
    expect(t.syncTombstone.findMany).not.toHaveBeenCalled();
    expect(tx.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });

  it("una página llena pide otra, con la posición del último", async () => {
    const rows = Array.from({ length: SYNC_PAGE_LIMITS.issues + 1 }, (_, i) =>
      issueRow(`id-${String(i).padStart(4, "0")}`, "2026-09-28T10:00:00Z")
    );
    fakeTx({ issues: rows });
    const body = await (await pull()).json();
    expect(body.has_more).toBe(true);
    expect(body.issues).toHaveLength(SYNC_PAGE_LIMITS.issues);
    const cursor = JSON.parse(Buffer.from(body.cursor, "base64url").toString());
    expect(cursor.k.issues).toEqual([Date.parse("2026-09-28T10:00:00Z"), "id-0199"]);
  });

  it("un cursor manipulado (tiempos imposibles) es una sync completa con reset, no un 500", async () => {
    const t = fakeTx({ issues: [] });
    const res = await pull(encodeCursor({ t: 1e300, at: 1e300, k: { issues: [1e300, "x"] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reset: true, has_more: false });
    // Ninguna consulta recibe una fecha: es la sync completa, sin límite inferior.
    const where = JSON.stringify(t.issue.findMany.mock.calls[0][0]);
    expect(where).not.toMatch(/Invalid Date|null/);
    expect(t.syncTombstone.findMany).not.toHaveBeenCalled();
  });

  it("una posición de tombstone por encima de bigint es reset, no un 500", async () => {
    const t = fakeTx({ issues: [] });
    const now = Date.now();
    const res = await pull(encodeCursor({ t: now - 60_000, at: now - 1000, k: { tombstones: [now - 5000, "9999999999999999999"] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reset: true });
    expect(t.syncTombstone.findMany).not.toHaveBeenCalled();
  });

  it("un tombstone de algo que volvió a existir (deshacer) no se manda", async () => {
    fakeTx({
      tombstones: [
        { id: BigInt(1), entity: "issue", entity_id: "gone", issue_id: "gone", deleted_at: new Date("2026-09-28T10:00:00Z") },
        { id: BigInt(2), entity: "issue", entity_id: "back", issue_id: "back", deleted_at: new Date("2026-09-28T10:00:01Z") },
      ],
      alive: ["back"],
    });
    const body = await (await pull(encodeCursor({ t: Date.now() - 60_000 }))).json();
    expect(body.tombstones).toEqual([
      { entity: "issue", entity_id: "gone", issue_id: "gone", deleted_at: "2026-09-28T10:00:00.000Z" },
    ]);
  });
});
