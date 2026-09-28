import { describe, it, expect } from "vitest";
import {
  CONFLICT_NODE_OFFSET,
  SYNC_MUTATION_RETENTION_MS,
  SYNC_OVERLAP_MS,
  SYNC_TOMBSTONE_RETENTION_MS,
  conflictTitle,
  decodeCursor,
  encodeCursor,
  nextCursor,
  planDelete,
  planIssueUpsert,
  planNodeUpsert,
  createPageBudget,
  isTombstoneId,
  mutationPayloadHash,
  planPull,
  syncPurgeCutoffs,
  textChangedElsewhere,
  textHash,
  type IssueNow,
  type NodeNow,
} from "./sync";
import type { SyncMutation } from "./sync-protocol";

const NOW = Date.parse("2026-09-28T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("textHash", () => {
  it("es el sha256 hex en UTF-8 — lo que calcula el teléfono", () => {
    expect(textHash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(textHash("<p>ñandú</p>")).toMatch(/^[0-9a-f]{64}$/);
    expect(textHash("<p>ñandú</p>")).not.toBe(textHash("<p>nandu</p>"));
  });
});

describe("cursor", () => {
  it("ida y vuelta", () => {
    const raw = encodeCursor({ t: NOW, at: NOW + 5, k: { issues: [NOW, "abc"] } });
    expect(decodeCursor(raw)).toEqual({ v: 1, t: NOW, at: NOW + 5, k: { issues: [NOW, "abc"] } });
  });

  it.each([
    ["basura", "no-es-un-cursor!!"],
    ["otra versión", Buffer.from(JSON.stringify({ v: 2, t: 1 })).toString("base64url")],
    ["t no numérico", Buffer.from(JSON.stringify({ v: 1, t: "x" })).toString("base64url")],
    ["entidad desconocida", Buffer.from(JSON.stringify({ v: 1, t: 1, at: 2, k: { users: [1, "a"] } })).toString("base64url")],
    ["posición mala", Buffer.from(JSON.stringify({ v: 1, t: 1, at: 2, k: { issues: [1] } })).toString("base64url")],
    ["demasiado largo", "a".repeat(3000)],
  ])("rechaza %s", (_label, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("planPull", () => {
  it("sin cursor: todo, sin reset", () => {
    expect(planPull(null, NOW)).toEqual({ from: null, since: null, at: NOW, after: {}, reset: false });
  });

  it("un cursor que no entiende: sync completa con reset", () => {
    expect(planPull("garbage", NOW)).toMatchObject({ from: null, reset: true, at: NOW });
  });

  it("lee una ventana antes del cursor, para no perder un commit lento", () => {
    const t = NOW - 60_000;
    const plan = planPull(encodeCursor({ t }), NOW);
    expect(plan.from?.getTime()).toBe(t - SYNC_OVERLAP_MS);
    expect(plan).toMatchObject({ since: t, at: NOW, after: {}, reset: false });
  });

  it("un cursor más viejo que la retención de borrados pide reset", () => {
    const t = NOW - SYNC_TOMBSTONE_RETENTION_MS; // con la ventana, ya cae antes del corte
    expect(planPull(encodeCursor({ t }), NOW)).toMatchObject({ from: null, reset: true });
    const fresh = NOW - SYNC_TOMBSTONE_RETENTION_MS + SYNC_OVERLAP_MS + 1000;
    expect(planPull(encodeCursor({ t: fresh }), NOW).reset).toBe(false);
  });

  it.each([
    ["t fuera del rango de Date", { t: 1e300 }],
    ["t en el futuro", { t: NOW + 60 * 60 * 1000 }],
    ["t negativo", { t: -1 }],
    ["t con decimales", { t: NOW - 1000.5 }],
    ["at fuera de rango", { t: NOW - DAY, at: 8.64e15 + 1 }],
    ["posición fuera de rango", { t: NOW - DAY, at: NOW - 1000, k: { issues: [1e300, "i9"] as [number, string] } }],
  ])("un cursor con tiempos que este servidor no emitió (%s): reset, nunca un error", (_label, data) => {
    expect(planPull(encodeCursor(data), NOW)).toMatchObject({ from: null, reset: true, at: NOW });
  });

  it.each([
    ["por encima de bigint", "9223372036854775808"],
    ["19 nueves", "9999999999999999999"],
    ["negativo", "-1"],
    ["con ceros adelante", "007"],
    ["no numérico", "abc"],
  ])("una posición de tombstone que no es un bigint (%s): reset", (_label, id) => {
    const raw = encodeCursor({ t: NOW - DAY, at: NOW - 1000, k: { tombstones: [NOW - 5000, id] } });
    expect(planPull(raw, NOW)).toMatchObject({ from: null, reset: true });
  });

  it("el bigint más grande sí es una posición válida", () => {
    const raw = encodeCursor({ t: NOW - DAY, at: NOW - 1000, k: { tombstones: [NOW - 5000, "9223372036854775807"] } });
    expect(planPull(raw, NOW).reset).toBe(false);
    expect(isTombstoneId("0")).toBe(true);
    expect(isTombstoneId("9223372036854775807")).toBe(true);
  });

  it("un cursor con la hora un poco adelantada (reloj de la base) se acepta", () => {
    expect(planPull(encodeCursor({ t: NOW + 60_000 }), NOW).reset).toBe(false);
  });

  it("a mitad de una ronda paginada sigue desde donde quedó, con el mismo inicio", () => {
    const raw = encodeCursor({ t: NOW - DAY, at: NOW - 1000, k: { issues: [NOW - 5000, "i9"] } });
    expect(planPull(raw, NOW)).toEqual({
      from: new Date(NOW - DAY - SYNC_OVERLAP_MS),
      since: NOW - DAY,
      at: NOW - 1000,
      after: { issues: [NOW - 5000, "i9"] },
      reset: false,
    });
  });

  it("una ronda completa entrega como cursor el momento en que empezó", () => {
    const plan = planPull(null, NOW);
    expect(decodeCursor(nextCursor(plan, { issues: [NOW - 1, "x"] }, false))).toEqual({ v: 1, t: NOW });
    expect(decodeCursor(nextCursor(plan, { issues: [NOW - 1, "x"] }, true))).toEqual({
      v: 1,
      t: null,
      at: NOW,
      k: { issues: [NOW - 1, "x"] },
    });
  });
});

describe("createPageBudget", () => {
  const row = (chars: number) => ({ d: "x".repeat(chars) });

  it("toma filas mientras entran y corta en la primera que no", () => {
    const b = createPageBudget(1000);
    expect([row(320), row(320), row(320), row(10)].map((r) => b.fits(r))).toEqual([true, true, true, false]); // 3 × 329 bytes + 19 > 1000
    expect(b.full).toBe(true);
  });

  it("una vez lleno no toma nada más, ni una fila chica: cada lista termina en su última fila tomada", () => {
    const b = createPageBudget(1000);
    b.fits(row(900));
    expect(b.fits(row(900))).toBe(false);
    expect(b.fits(row(1))).toBe(false);
    expect(b.fits(null)).toBe(false);
  });

  it("la primera fila entra aunque sola pase el límite: la página siempre avanza", () => {
    const b = createPageBudget(1000);
    expect(b.fits(row(5000))).toBe(true);
    expect(b.fits(row(1))).toBe(false);
  });

  it("una fila que no se manda (null) no ocupa lugar", () => {
    const b = createPageBudget(1000);
    expect(b.fits(null)).toBe(true);
    expect(b.fits(row(900))).toBe(true);
  });

  it("cuenta bytes, no caracteres", () => {
    const b = createPageBudget(1000);
    expect(b.fits({ d: "é".repeat(300) })).toBe(true); // ~600 bytes
    expect(b.fits({ d: "é".repeat(300) })).toBe(false);
  });
});

describe("syncPurgeCutoffs", () => {
  it("60 días para los borrados, 30 para las respuestas", () => {
    const { tombstonesBefore, mutationsBefore } = syncPurgeCutoffs(new Date(NOW));
    expect(tombstonesBefore.getTime()).toBe(NOW - 60 * DAY);
    expect(mutationsBefore.getTime()).toBe(NOW - 30 * DAY);
    expect(SYNC_MUTATION_RETENTION_MS).toBeLessThan(SYNC_TOMBSTONE_RETENTION_MS);
  });

  it("todo cursor que la pull acepta sigue teniendo sus borrados", () => {
    // Lo más viejo que planPull acepta leer, contra lo que la purga de hoy borró.
    const oldestRead = NOW - SYNC_TOMBSTONE_RETENTION_MS;
    expect(oldestRead).toBeGreaterThanOrEqual(syncPurgeCutoffs(new Date(NOW)).tombstonesBefore.getTime());
  });
});

describe("textChangedElsewhere", () => {
  const base = textHash("<p>a</p>");
  it("mismo texto base: no hay conflicto", () => {
    expect(textChangedElsewhere("<p>a</p>", "<p>ab</p>", base)).toBe(false);
  });
  it("el servidor cambió el texto: conflicto", () => {
    expect(textChangedElsewhere("<p>web</p>", "<p>ab</p>", base)).toBe(true);
  });
  it("los dos llegaron al mismo texto: no hay conflicto", () => {
    expect(textChangedElsewhere("<p>ab</p>", "<p>ab</p>", base)).toBe(false);
  });
  it("sin hash base (fila creada en el teléfono), gana el teléfono", () => {
    expect(textChangedElsewhere("<p>web</p>", "<p>ab</p>", null)).toBe(false);
  });
});

const note: IssueNow = {
  title: "Pricing",
  category: "note",
  note_format: "text",
  description: "<p>a</p>",
  client_id: null,
};

describe("planIssueUpsert", () => {
  it("crea una fila nueva con el id del teléfono", () => {
    expect(planIssueUpsert(null, { fields: { title: "Nueva", category: "note", description: "<p>x</p>" } })).toEqual({
      action: "create",
      data: { title: "Nueva", category: "note", description: "<p>x</p>" },
    });
  });

  it("crear sin título es inválido", () => {
    expect(planIssueUpsert(null, { fields: { title: "  " } })).toEqual({ action: "reject", reason: "invalid" });
  });

  it("aplica solo los campos que vinieron, última escritura gana", () => {
    expect(planIssueUpsert(note, { base_updated_at: "x", fields: { title: "Otro" } })).toEqual({
      action: "update",
      data: { title: "Otro" },
    });
  });

  it("texto cambiado en el servidor: guarda el suyo y manda el del teléfono a una copia", () => {
    const plan = planIssueUpsert(
      { ...note, description: "<p>web</p>" },
      { base_updated_at: "x", base_hash: textHash("<p>a</p>"), fields: { description: "<p>phone</p>", status: "blocked" } }
    );
    expect(plan).toEqual({ action: "update", data: { status: "blocked" }, conflictText: "<p>phone</p>" });
  });

  it("texto sin cambios en el servidor: se aplica", () => {
    expect(
      planIssueUpsert(note, { base_updated_at: "x", base_hash: textHash("<p>a</p>"), fields: { description: "<p>b</p>" } })
    ).toEqual({ action: "update", data: { description: "<p>b</p>" } });
  });

  it("editar una fila borrada en el servidor: con texto, se recupera como copia", () => {
    expect(planIssueUpsert(null, { base_updated_at: "x", fields: { description: "<p>algo</p>" } })).toEqual({
      action: "recover",
      text: "<p>algo</p>",
    });
  });

  it("editar una fila borrada sin texto (o con texto vacío): deleted", () => {
    expect(planIssueUpsert(null, { base_updated_at: "x", fields: { status: "done" } })).toEqual({ action: "gone" });
    expect(planIssueUpsert(null, { base_updated_at: "x", fields: { description: "<p></p>" } })).toEqual({ action: "gone" });
  });

  it("nota ↔ task se permite, como en la web", () => {
    expect(planIssueUpsert(note, { base_updated_at: "x", fields: { category: "task" } }).action).toBe("update");
  });

  it("convertir una nota de texto en canvas: el texto viaja como primera idea, el servidor no siembra otra", () => {
    expect(
      planIssueUpsert(note, {
        base_updated_at: "x",
        base_hash: textHash("<p>a</p>"),
        fields: { note_format: "canvas", description: "" },
      })
    ).toEqual({ action: "update", data: { note_format: "canvas", description: "" } });
  });

  it("convertir cuando el texto cambió en el servidor: convierte sin el texto del teléfono (el servidor siembra el suyo) y sin copia", () => {
    expect(
      planIssueUpsert(
        { ...note, description: "<p>web</p>" },
        { base_updated_at: "x", base_hash: textHash("<p>a</p>"), fields: { note_format: "canvas", description: "" } }
      )
    ).toEqual({ action: "update", data: { note_format: "canvas" } });
  });

  it("convertir con texto propio cuando el servidor cambió el suyo: el del teléfono queda como copia", () => {
    expect(
      planIssueUpsert(
        { ...note, description: "<p>web</p>" },
        { base_updated_at: "x", base_hash: textHash("<p>a</p>"), fields: { note_format: "canvas", description: "<p>teléfono</p>" } }
      )
    ).toEqual({ action: "update", data: { note_format: "canvas" }, conflictText: "<p>teléfono</p>" });
  });

  it("texto escrito en una nota que la web ya convirtió en canvas: no va a la descripción, queda como copia", () => {
    const canvas = { ...note, note_format: "canvas" as const, description: "" };
    expect(
      planIssueUpsert(canvas, { base_updated_at: "x", base_hash: textHash(""), fields: { description: "<p>hola</p>", status: "done" } })
    ).toEqual({ action: "update", data: { status: "done" }, conflictText: "<p>hola</p>" });
  });

  it("una descripción vacía sobre un canvas se escribe tal cual (no hay nada que perder)", () => {
    const canvas = { ...note, note_format: "canvas" as const, description: "" };
    expect(planIssueUpsert(canvas, { base_updated_at: "x", base_hash: textHash(""), fields: { description: "" } })).toEqual({
      action: "update",
      data: { description: "" },
    });
  });

  it("crear un canvas desde el teléfono", () => {
    expect(planIssueUpsert(null, { fields: { title: "c", category: "note", note_format: "canvas" } })).toEqual({
      action: "create",
      data: { title: "c", category: "note", note_format: "canvas" },
    });
  });

  it("un canvas no vuelve a texto ni una task es canvas (las reglas de lib/notes.ts)", () => {
    expect(
      planIssueUpsert({ ...note, note_format: "canvas" }, { base_updated_at: "x", fields: { note_format: "text" } })
    ).toEqual({ action: "reject", reason: "shape" });
    expect(planIssueUpsert(null, { fields: { title: "c", category: "task", note_format: "canvas" } })).toEqual({
      action: "reject",
      reason: "shape",
    });
  });

  it("mandar el mismo formato que ya tiene no es un cambio", () => {
    expect(planIssueUpsert(note, { base_updated_at: "x", fields: { note_format: "text", title: "t" } }).action).toBe("update");
  });

  it("un canvas no se convierte en task (las reglas de lib/notes.ts)", () => {
    expect(
      planIssueUpsert({ ...note, note_format: "canvas" }, { base_updated_at: "x", fields: { category: "task" } })
    ).toEqual({ action: "reject", reason: "shape" });
  });
});

const node: NodeNow = { issue_id: "c1", content: "<p>a</p>", color: null, x: 10, y: 20, width: 280, height: 160 };

describe("planNodeUpsert", () => {
  it("crea una idea en un canvas", () => {
    expect(planNodeUpsert(null, { fields: { issue_id: "c1", x: 0, y: 0, content: "" } }, { isCanvas: true })).toEqual({
      action: "create",
      data: { issue_id: "c1", x: 0, y: 0, content: "" },
    });
  });

  it("no crea una idea en algo que no es canvas", () => {
    expect(planNodeUpsert(null, { fields: { issue_id: "t1", x: 0, y: 0 } }, { isCanvas: false })).toEqual({
      action: "reject",
      reason: "not_a_canvas",
    });
  });

  it("crear sin posición es inválido", () => {
    expect(planNodeUpsert(null, { fields: { issue_id: "c1" } }, { isCanvas: true })).toEqual({
      action: "reject",
      reason: "invalid",
    });
  });

  it("el canvas se borró mientras el teléfono agregaba una idea con texto: se recupera", () => {
    expect(planNodeUpsert(null, { fields: { issue_id: "c1", x: 0, y: 0, content: "<p>idea</p>" } }, null)).toEqual({
      action: "recover",
      text: "<p>idea</p>",
    });
  });

  it("idea borrada en el servidor, edición sin texto: deleted", () => {
    expect(planNodeUpsert(null, { base_updated_at: "x", fields: { x: 5 } }, { isCanvas: true })).toEqual({ action: "gone" });
  });

  it("texto cambiado en el servidor: copia hermana corrida 24 px, lo demás se aplica", () => {
    const plan = planNodeUpsert(
      { ...node, content: "<p>web</p>" },
      { base_updated_at: "x", base_hash: textHash("<p>a</p>"), fields: { content: "<p>phone</p>", x: 100 } },
      { isCanvas: true }
    );
    expect(plan).toEqual({
      action: "update",
      data: { x: 100 },
      conflictCopy: {
        issue_id: "c1",
        content: "<p>phone</p>",
        color: null,
        width: 280,
        x: 100 + CONFLICT_NODE_OFFSET,
        y: 20 + CONFLICT_NODE_OFFSET,
      },
    });
  });

  it("una idea no se muda de canvas", () => {
    expect(planNodeUpsert(node, { base_updated_at: "x", fields: { issue_id: "otro" } }, { isCanvas: true })).toEqual({
      action: "reject",
      reason: "invalid",
    });
  });
});

describe("planDelete", () => {
  it("borrar algo que ya no existe es éxito", () => {
    expect(planDelete(null, "h")).toEqual({ action: "noop" });
  });
  it("borra si el texto es el que el teléfono vio", () => {
    expect(planDelete("<p>a</p>", textHash("<p>a</p>"))).toEqual({ action: "delete" });
    expect(planDelete("<p>a</p>", null)).toEqual({ action: "delete" });
  });
  it("no borra palabras que el teléfono nunca mostró", () => {
    expect(planDelete("<p>web</p>", textHash("<p>a</p>"))).toEqual({ action: "reject", reason: "changed_on_server" });
  });
  it("si el servidor ya lo vació, no hay palabras que perder", () => {
    expect(planDelete("<p></p>", textHash("<p>a</p>"))).toEqual({ action: "delete" });
  });
});

describe("mutationPayloadHash", () => {
  const change: SyncMutation = { mutation_id: "m1", entity: "issue", op: "upsert", id: "i1", fields: { title: "a", description: "<p>b</p>" } };

  it("no depende del orden de las claves, a ninguna profundidad", () => {
    const reordered: SyncMutation = { fields: { description: "<p>b</p>", title: "a" }, id: "i1", op: "upsert", entity: "issue", mutation_id: "m1" };
    expect(mutationPayloadHash(reordered)).toBe(mutationPayloadHash(change));
  });

  it("no incluye el id del cambio, sí todo lo que lleva", () => {
    expect(mutationPayloadHash({ ...change, mutation_id: "otro" })).toBe(mutationPayloadHash(change));
    expect(mutationPayloadHash({ ...change, fields: { title: "a", description: "<p>c</p>" } })).not.toBe(mutationPayloadHash(change));
    expect(mutationPayloadHash({ ...change, id: "i2" })).not.toBe(mutationPayloadHash(change));
    expect(mutationPayloadHash({ ...change, op: "delete" })).not.toBe(mutationPayloadHash(change));
  });
});

describe("conflictTitle — límite", () => {
  it("un título ya en el límite se corta para que la copia no lo pase", () => {
    const t = conflictTitle("x".repeat(500));
    expect(t.length).toBeLessThanOrEqual(500);
    expect(t.endsWith(" (conflict)")).toBe(true);
  });
});

describe("conflictTitle", () => {
  it("marca al final y cae a un nombre si no hay título", () => {
    expect(conflictTitle("Pricing")).toBe("Pricing (conflict)");
    expect(conflictTitle("  ")).toBe("Recovered note (conflict)");
    expect(conflictTitle(undefined, "Recovered idea")).toBe("Recovered idea (conflict)");
  });
});
