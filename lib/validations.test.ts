import { describe, it, expect } from "vitest";
import {
  BulkDeleteIssuesSchema,
  CanvasEdgeSchema,
  CanvasLayoutSchema,
  CanvasNodePatchSchema,
  CanvasNodeSchema,
  IssueSchema,
  SettingsPatchSchema,
} from "./validations";
import { CANVAS_BOUND } from "./canvas-geometry";
import {
  LAYOUT_BATCH_MAX,
  NODE_CONTENT_MAX,
  NODE_MAX_SIZE,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
} from "./note-canvas";

describe("BulkDeleteIssuesSchema", () => {
  it("acepta una lista de ids", () => {
    expect(BulkDeleteIssuesSchema.safeParse({ ids: ["a", "b"] }).success).toBe(
      true
    );
  });

  it("rechaza una lista vacía — borrar nada no es una operación", () => {
    expect(BulkDeleteIssuesSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it("rechaza un id vacío", () => {
    expect(BulkDeleteIssuesSchema.safeParse({ ids: [""] }).success).toBe(false);
  });

  it("acota el lote: 500 pasa, 501 no", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);
    expect(BulkDeleteIssuesSchema.safeParse({ ids: ids(500) }).success).toBe(true);
    expect(BulkDeleteIssuesSchema.safeParse({ ids: ids(501) }).success).toBe(false);
  });

  it("rechaza el body sin ids en vez de borrar por omisión", () => {
    expect(BulkDeleteIssuesSchema.safeParse({}).success).toBe(false);
    expect(BulkDeleteIssuesSchema.safeParse(undefined).success).toBe(false);
  });
});

// ─── Canvas notes ────────────────────────────────────────────────────────────

const UUID = "3f2b8c1e-6a4d-4e9b-9c7a-1d2e3f4a5b6c";

describe("IssueSchema — note_format", () => {
  it("por defecto una issue es de texto", () => {
    const parsed = IssueSchema.safeParse({ title: "x" });
    expect(parsed.success && parsed.data.note_format).toBe("text");
  });

  it("acepta canvas y rechaza un formato inventado", () => {
    expect(
      IssueSchema.safeParse({ title: "x", category: "note", note_format: "canvas" })
        .success
    ).toBe(true);
    expect(
      IssueSchema.safeParse({ title: "x", note_format: "whiteboard" }).success
    ).toBe(false);
  });
});

describe("CanvasNodeSchema", () => {
  it("un nodo nuevo solo necesita dónde va", () => {
    const parsed = CanvasNodeSchema.safeParse({ x: 0, y: 0 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.content).toBe("");
  });

  it("acepta un id elegido por el cliente, si es un UUID", () => {
    expect(CanvasNodeSchema.safeParse({ id: UUID, x: 0, y: 0 }).success).toBe(true);
    expect(CanvasNodeSchema.safeParse({ id: "mio", x: 0, y: 0 }).success).toBe(
      false
    );
  });

  it("rechaza NaN, Infinity y coordenadas fuera del límite navegable", () => {
    expect(CanvasNodeSchema.safeParse({ x: NaN, y: 0 }).success).toBe(false);
    expect(CanvasNodeSchema.safeParse({ x: 0, y: Infinity }).success).toBe(false);
    expect(
      CanvasNodeSchema.safeParse({ x: CANVAS_BOUND + 1, y: 0 }).success
    ).toBe(false);
  });

  it("acota el tamaño: ni una tarjeta invisible ni una desbocada", () => {
    const at = { x: 0, y: 0 };
    expect(
      CanvasNodeSchema.safeParse({ ...at, width: NODE_MIN_WIDTH, height: NODE_MIN_HEIGHT })
        .success
    ).toBe(true);
    expect(CanvasNodeSchema.safeParse({ ...at, width: NODE_MIN_WIDTH - 1 }).success).toBe(
      false
    );
    expect(CanvasNodeSchema.safeParse({ ...at, height: NODE_MAX_SIZE + 1 }).success).toBe(
      false
    );
  });

  it("acota el contenido de un nodo", () => {
    const at = { x: 0, y: 0 };
    expect(
      CanvasNodeSchema.safeParse({ ...at, content: "x".repeat(NODE_CONTENT_MAX) })
        .success
    ).toBe(true);
    expect(
      CanvasNodeSchema.safeParse({ ...at, content: "x".repeat(NODE_CONTENT_MAX + 1) })
        .success
    ).toBe(false);
  });

  it("el color es una clave de la paleta o null", () => {
    const at = { x: 0, y: 0 };
    expect(CanvasNodeSchema.safeParse({ ...at, color: "blue" }).success).toBe(true);
    expect(CanvasNodeSchema.safeParse({ ...at, color: null }).success).toBe(true);
    expect(CanvasNodeSchema.safeParse({ ...at, color: "#ff0000" }).success).toBe(
      false
    );
  });
});

describe("CanvasNodePatchSchema", () => {
  it("permite volver al color neutro sin tocar el contenido", () => {
    const parsed = CanvasNodePatchSchema.safeParse({ color: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.content).toBeUndefined();
  });
});

describe("CanvasLayoutSchema", () => {
  it("acepta un lote con y sin tamaño", () => {
    expect(
      CanvasLayoutSchema.safeParse({
        nodes: [
          { id: "a", x: 8, y: 16 },
          { id: "b", x: 0, y: 0, width: 320, height: 200 },
        ],
      }).success
    ).toBe(true);
  });

  it("rechaza un lote vacío y uno desbocado", () => {
    expect(CanvasLayoutSchema.safeParse({ nodes: [] }).success).toBe(false);
    const nodes = Array.from({ length: LAYOUT_BATCH_MAX + 1 }, (_, i) => ({
      id: `n${i}`,
      x: 0,
      y: 0,
    }));
    expect(CanvasLayoutSchema.safeParse({ nodes }).success).toBe(false);
  });

  it("aplica el mismo límite de tamaño que al crear", () => {
    expect(
      CanvasLayoutSchema.safeParse({ nodes: [{ id: "a", x: 0, y: 0, width: 10 }] })
        .success
    ).toBe(false);
  });
});

describe("CanvasEdgeSchema", () => {
  it("acepta una conexión entre dos ideas", () => {
    expect(
      CanvasEdgeSchema.safeParse({ id: UUID, source_id: "a", target_id: "b" }).success
    ).toBe(true);
  });

  it("rechaza el auto-enlace — el CHECK de la DB es el backstop, esto es el 400", () => {
    const parsed = CanvasEdgeSchema.safeParse({ source_id: "a", target_id: "a" });
    expect(parsed.success).toBe(false);
  });
});

describe("SettingsPatchSchema", () => {
  it("acepta cambiar solo los clientes excluidos", () => {
    const parsed = SettingsPatchSchema.safeParse({ corporate_excluded_client_ids: ["c1"] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.days_before_invoice).toBeUndefined();
  });

  it("deduplica la lista de excluidos", () => {
    const parsed = SettingsPatchSchema.safeParse({ corporate_excluded_client_ids: ["c1", "c1", "c2"] });
    expect(parsed.success && parsed.data.corporate_excluded_client_ids).toEqual(["c1", "c2"]);
  });

  it("una lista vacía es válida: no excluir a nadie", () => {
    expect(SettingsPatchSchema.safeParse({ corporate_excluded_client_ids: [] }).success).toBe(true);
  });

  it("rechaza ids vacíos y días fuera de rango", () => {
    expect(SettingsPatchSchema.safeParse({ corporate_excluded_client_ids: [""] }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ days_before_salary: 31 }).success).toBe(false);
  });
});
