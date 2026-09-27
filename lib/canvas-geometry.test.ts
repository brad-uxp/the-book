import { describe, it, expect } from "vitest";
import { snapToGrid, edgeAnchor, type Rect } from "./canvas-geometry";

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
