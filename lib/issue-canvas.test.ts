import { describe, it, expect } from "vitest";
import {
  layoutUnplaced,
  isPlaced,
  snapToGrid,
  CARD_WIDTH,
  CARD_HEIGHT,
  CARD_GAP,
  CANVAS_BOUND,
  edgeAnchor,
  type Placeable,
  type Rect,
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

describe("edgeAnchor", () => {
  // Una card de 100×100 en el origen; la otra se mueve alrededor.
  const box = (x: number, y: number): Rect => ({ x, y, width: 100, height: 100 });
  const origin = box(0, 0);

  it("sale por la derecha hacia una card a la derecha", () => {
    expect(edgeAnchor(origin, box(500, 0))).toEqual({ x: 100, y: 50, side: "right" });
  });

  it("sale por la izquierda hacia una card a la izquierda", () => {
    expect(edgeAnchor(origin, box(-500, 0))).toEqual({ x: 0, y: 50, side: "left" });
  });

  it("sale por abajo hacia una card debajo", () => {
    expect(edgeAnchor(origin, box(0, 500))).toEqual({ x: 50, y: 100, side: "bottom" });
  });

  it("sale por arriba hacia una card encima", () => {
    expect(edgeAnchor(origin, box(0, -500))).toEqual({ x: 50, y: 0, side: "top" });
  });

  it("el ancla siempre cae sobre el borde de la card, nunca adentro ni afuera", () => {
    for (const angle of [0, 30, 45, 60, 90, 135, 180, 225, 270, 315]) {
      const rad = (angle * Math.PI) / 180;
      const target = box(50 + 400 * Math.cos(rad) - 50, 50 + 400 * Math.sin(rad) - 50);
      const a = edgeAnchor(origin, target);

      const onVertical = Math.abs(a.x) < 1e-9 || Math.abs(a.x - 100) < 1e-9;
      const onHorizontal = Math.abs(a.y) < 1e-9 || Math.abs(a.y - 100) < 1e-9;
      expect(onVertical || onHorizontal, `ángulo ${angle}`).toBe(true);
      expect(a.x >= -1e-9 && a.x <= 100 + 1e-9, `ángulo ${angle}`).toBe(true);
      expect(a.y >= -1e-9 && a.y <= 100 + 1e-9, `ángulo ${angle}`).toBe(true);
    }
  });

  it("es simétrico — la línea A→B y la B→A se encuentran en el medio", () => {
    const a = box(0, 0);
    const b = box(300, 200);
    const from = edgeAnchor(a, b);
    const to = edgeAnchor(b, a);
    // Cada extremo apunta al otro: lados opuestos.
    expect(from.side).toBe("right");
    expect(to.side).toBe("left");
  });

  it("no divide por cero cuando dos cards están una sobre la otra", () => {
    const a = edgeAnchor(origin, box(0, 0));
    expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
  });

  it("resuelve la diagonal exacta sin quedar en un lado indefinido", () => {
    // 45° con cards cuadradas: la esquina. Cualquiera de los dos lados es
    // correcto, pero tiene que ser uno y estar sobre el borde.
    const a = edgeAnchor(origin, box(400, 400));
    expect(a).toEqual({ x: 100, y: 100, side: "right" });
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
