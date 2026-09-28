import { describe, it, expect } from "vitest";
import { snapToGrid, edgeAnchor, sideAnchor, connectionAnchors, isSide, type Rect } from "./canvas-geometry";

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

describe("sideAnchor", () => {
  const card: Rect = { x: 100, y: 50, width: 200, height: 80 };
  it.each([
    ["top", { x: 200, y: 50 }],
    ["right", { x: 300, y: 90 }],
    ["bottom", { x: 200, y: 130 }],
    ["left", { x: 100, y: 90 }],
  ] as const)("%s: el medio de ese lado", (side, point) => {
    expect(sideAnchor(card, side)).toEqual({ ...point, side });
  });
});

describe("connectionAnchors", () => {
  const a: Rect = { x: 0, y: 0, width: 100, height: 40 };
  const b: Rect = { x: 400, y: 0, width: 100, height: 40 };

  it("sin lados fijos, es lo mismo que antes: cada extremo mira a la otra tarjeta", () => {
    expect(connectionAnchors(a, b)).toEqual({ start: edgeAnchor(a, b), end: edgeAnchor(b, a) });
  });

  it("con los dos lados fijos, sale y llega por esos lados aunque no se miren", () => {
    const { start, end } = connectionAnchors(a, b, "bottom", "top");
    expect(start).toEqual({ x: 50, y: 40, side: "bottom" });
    expect(end).toEqual({ x: 450, y: 0, side: "top" });
  });

  it("con un solo extremo fijo, el otro apunta a ese punto y no al centro de la tarjeta", () => {
    // B fijo arriba: el extremo libre en A mira hacia (450, 0), no hacia el centro de B.
    const below: Rect = { x: 400, y: 300, width: 100, height: 40 };
    const { start, end } = connectionAnchors(a, below, null, "top");
    expect(end).toEqual({ x: 450, y: 300, side: "top" });
    expect(start).toEqual(edgeAnchor(a, { x: 450, y: 300, width: 0, height: 0 }));
  });

  it("isSide reconoce solo los cuatro lados", () => {
    expect(["top", "right", "bottom", "left"].every(isSide)).toBe(true);
    expect([null, "", "center", "TOP", 1].some(isSide)).toBe(false);
  });
});
