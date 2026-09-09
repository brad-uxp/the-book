import { describe, it, expect } from "vitest";
import {
  layoutUnplaced,
  isPlaced,
  snapToGrid,
  CARD_WIDTH,
  CARD_HEIGHT,
  CARD_GAP,
  CANVAS_BOUND,
  type Placeable,
} from "./issue-canvas";

const at = (id: string, x: number | null, y: number | null): Placeable => ({
  id,
  canvas_x: x,
  canvas_y: y,
});

describe("isPlaced", () => {
  it("acepta un par de coordenadas reales", () => {
    expect(isPlaced(at("a", 0, 0))).toBe(true);
    expect(isPlaced(at("a", -120.5, 340))).toBe(true);
  });

  it("rechaza el issue que nunca se ubicó", () => {
    expect(isPlaced(at("a", null, null))).toBe(false);
  });

  it("rechaza media posición — un eje sin el otro no ubica nada", () => {
    expect(isPlaced(at("a", 100, null))).toBe(false);
    expect(isPlaced(at("a", null, 100))).toBe(false);
  });

  it("rechaza NaN e Infinity en vez de dejar la card en un lugar irrecuperable", () => {
    expect(isPlaced(at("a", NaN, 0))).toBe(false);
    expect(isPlaced(at("a", 0, Infinity))).toBe(false);
  });

  it("rechaza coordenadas fuera del límite navegable", () => {
    expect(isPlaced(at("a", CANVAS_BOUND + 1, 0))).toBe(false);
    expect(isPlaced(at("a", 0, -CANVAS_BOUND - 1))).toBe(false);
    expect(isPlaced(at("a", CANVAS_BOUND, 0))).toBe(true);
  });
});

describe("layoutUnplaced", () => {
  it("no toca a los que ya tienen posición — eso es todo el punto de persistir", () => {
    const issues = [at("a", 40, 40), at("b", 300, 900)];
    expect(layoutUnplaced(issues)).toEqual([]);
  });

  it("devuelve solo los que faltan ubicar", () => {
    const result = layoutUnplaced([at("a", 0, 0), at("b", null, null)]);
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });

  it("arranca en el origen cuando el canvas está vacío", () => {
    const result = layoutUnplaced([at("a", null, null)]);
    expect(result[0]).toEqual({ id: "a", x: 0, y: 0 });
  });

  it("acomoda en grilla y envuelve al llegar al ancho pedido", () => {
    const issues = ["a", "b", "c", "d"].map((id) => at(id, null, null));
    const result = layoutUnplaced(issues, 2);

    expect(result).toEqual([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: CARD_WIDTH + CARD_GAP, y: 0 },
      { id: "c", x: 0, y: CARD_HEIGHT + CARD_GAP },
      { id: "d", x: CARD_WIDTH + CARD_GAP, y: CARD_HEIGHT + CARD_GAP },
    ]);
  });

  it("ubica los nuevos DEBAJO de todo lo que el usuario acomodó a mano", () => {
    const placed = at("viejo", 500, 800);
    const [nuevo] = layoutUnplaced([placed, at("nuevo", null, null)]);

    expect(nuevo.y).toBe(800 + CARD_HEIGHT + CARD_GAP);
    // Alineado con la card más a la izquierda, no con la más abajo.
    expect(nuevo.x).toBe(500);
  });

  it("re-ubica una posición corrupta en lugar de dejar la card perdida", () => {
    // Un NaN guardado no cuenta como ubicado: la card vuelve a la grilla, y no
    // arrastra el NaN al origen de las demás.
    const result = layoutUnplaced([
      at("roto", NaN, NaN),
      at("nuevo", null, null),
    ]);

    expect(result.map((r) => r.id)).toEqual(["roto", "nuevo"]);
    expect(result.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y))).toBe(
      true
    );
    expect(result[0]).toEqual({ id: "roto", x: 0, y: 0 });
  });

  it("es determinista — dos pestañas abriendo el canvas guardan lo mismo", () => {
    const issues = ["a", "b", "c"].map((id) => at(id, null, null));
    expect(layoutUnplaced(issues)).toEqual(layoutUnplaced(issues));
  });

  it("nunca superpone dos cards recién ubicadas", () => {
    const issues = Array.from({ length: 12 }, (_, i) => at(`i${i}`, null, null));
    const result = layoutUnplaced(issues, 4);
    const seen = new Set(result.map((r) => `${r.x},${r.y}`));
    expect(seen.size).toBe(result.length);
  });

  it("tolera un ancho de columnas absurdo sin colapsar la grilla", () => {
    const issues = ["a", "b"].map((id) => at(id, null, null));
    const result = layoutUnplaced(issues, 0);
    expect(result[0]).toEqual({ id: "a", x: 0, y: 0 });
    expect(result[1].y).toBe(CARD_HEIGHT + CARD_GAP);
  });
});

describe("snapToGrid", () => {
  it("redondea al múltiplo de grilla más cercano", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(3)).toBe(0);
    expect(snapToGrid(5)).toBe(8);
    expect(snapToGrid(-5)).toBe(-8);
  });
});
