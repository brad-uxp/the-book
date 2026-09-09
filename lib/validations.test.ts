import { describe, it, expect } from "vitest";
import {
  BulkDeleteIssuesSchema,
  CanvasLabelPatchSchema,
  CanvasLabelSchema,
  CanvasPositionsSchema,
  IssueLinkSchema,
} from "./validations";
import { DEFAULT_LABEL_COLOR } from "./canvas-labels";
import { CANVAS_BOUND } from "./issue-canvas";

describe("CanvasPositionsSchema", () => {
  it("acepta un lote de posiciones", () => {
    const parsed = CanvasPositionsSchema.safeParse({
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: -240.5, y: 1080 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rechaza un lote vacío en vez de hacer un round-trip inútil", () => {
    expect(CanvasPositionsSchema.safeParse({ nodes: [] }).success).toBe(false);
  });

  it("rechaza NaN e Infinity — persistirlos deja la card irrecuperable", () => {
    expect(
      CanvasPositionsSchema.safeParse({ nodes: [{ id: "a", x: NaN, y: 0 }] })
        .success
    ).toBe(false);
    expect(
      CanvasPositionsSchema.safeParse({
        nodes: [{ id: "a", x: 0, y: Infinity }],
      }).success
    ).toBe(false);
  });

  it("rechaza coordenadas fuera del límite navegable", () => {
    expect(
      CanvasPositionsSchema.safeParse({
        nodes: [{ id: "a", x: CANVAS_BOUND + 1, y: 0 }],
      }).success
    ).toBe(false);
  });

  it("rechaza un id vacío", () => {
    expect(
      CanvasPositionsSchema.safeParse({ nodes: [{ id: "", x: 0, y: 0 }] })
        .success
    ).toBe(false);
  });

  it("acota el tamaño del lote", () => {
    const nodes = Array.from({ length: 1001 }, (_, i) => ({
      id: `i${i}`,
      x: 0,
      y: 0,
    }));
    expect(CanvasPositionsSchema.safeParse({ nodes }).success).toBe(false);
  });
});

describe("CanvasPositionsSchema — lote mixto", () => {
  it("acepta issues y chips en la misma escritura", () => {
    const parsed = CanvasPositionsSchema.safeParse({
      nodes: [{ id: "a", x: 0, y: 0 }],
      labels: [{ id: "l1", x: 40, y: 40 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("acepta solo chips", () => {
    expect(
      CanvasPositionsSchema.safeParse({ labels: [{ id: "l1", x: 0, y: 0 }] })
        .success
    ).toBe(true);
  });

  it("rechaza el lote donde ninguno de los dos trae nada", () => {
    expect(CanvasPositionsSchema.safeParse({}).success).toBe(false);
    expect(
      CanvasPositionsSchema.safeParse({ nodes: [], labels: [] }).success
    ).toBe(false);
  });

  it("aplica el mismo límite de coordenadas a los chips", () => {
    expect(
      CanvasPositionsSchema.safeParse({
        labels: [{ id: "l1", x: NaN, y: 0 }],
      }).success
    ).toBe(false);
  });
});

describe("CanvasLabelSchema", () => {
  it("un chip nuevo puede nacer sin texto y con el color por defecto", () => {
    const parsed = CanvasLabelSchema.safeParse({ x: 0, y: 0 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.text).toBe("");
      expect(parsed.data.color).toBe(DEFAULT_LABEL_COLOR);
    }
  });

  it("rechaza un color fuera de la paleta", () => {
    expect(
      CanvasLabelSchema.safeParse({ x: 0, y: 0, color: "chartreuse" }).success
    ).toBe(false);
  });

  it("acota el largo del texto", () => {
    expect(
      CanvasLabelSchema.safeParse({ x: 0, y: 0, text: "x".repeat(200) }).success
    ).toBe(true);
    expect(
      CanvasLabelSchema.safeParse({ x: 0, y: 0, text: "x".repeat(201) }).success
    ).toBe(false);
  });

  it("exige posición — un chip sin coordenadas no se puede dibujar", () => {
    expect(CanvasLabelSchema.safeParse({ text: "hola" }).success).toBe(false);
  });
});

describe("CanvasLabelPatchSchema", () => {
  it("permite cambiar solo el color, sin tocar el texto", () => {
    const parsed = CanvasLabelPatchSchema.safeParse({ color: "blue" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.text).toBeUndefined();
  });

  it("rechaza un color inventado también al editar", () => {
    expect(CanvasLabelPatchSchema.safeParse({ color: "nope" }).success).toBe(
      false
    );
  });
});

describe("IssueLinkSchema", () => {
  it("acepta una arista entre dos issues distintos", () => {
    const parsed = IssueLinkSchema.safeParse({
      source_id: "a",
      target_id: "b",
    });
    expect(parsed.success).toBe(true);
  });

  it("rechaza el auto-enlace — el CHECK de la DB es el backstop, esto es el 400", () => {
    const parsed = IssueLinkSchema.safeParse({
      source_id: "a",
      target_id: "a",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(["target_id"]);
    }
  });

  it("acepta label nulo o ausente", () => {
    expect(
      IssueLinkSchema.safeParse({ source_id: "a", target_id: "b", label: null })
        .success
    ).toBe(true);
    expect(
      IssueLinkSchema.safeParse({ source_id: "a", target_id: "b" }).success
    ).toBe(true);
  });

  it("recorta el label y acota su largo", () => {
    const parsed = IssueLinkSchema.safeParse({
      source_id: "a",
      target_id: "b",
      label: "  bloquea a  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.label).toBe("bloquea a");

    expect(
      IssueLinkSchema.safeParse({
        source_id: "a",
        target_id: "b",
        label: "x".repeat(81),
      }).success
    ).toBe(false);
  });
});

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
