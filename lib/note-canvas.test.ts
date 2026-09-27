import { describe, it, expect } from "vitest";
import { GRID_SIZE } from "./canvas-geometry";
import { NODE_DEFAULT_HEIGHT, NODE_DEFAULT_WIDTH, nodeOriginAt } from "./note-canvas";

describe("nodeOriginAt", () => {
  it("centra la tarjeta donde se hizo doble clic", () => {
    // Un punto cuyo origen ya cae en la grilla, para que el snap no mueva nada.
    expect(nodeOriginAt({ x: 1140, y: 880 })).toEqual({
      x: 1140 - NODE_DEFAULT_WIDTH / 2,
      y: 880 - NODE_DEFAULT_HEIGHT / 2,
    });
  });

  it("cae sobre la grilla, igual que un arrastre", () => {
    const { x, y } = nodeOriginAt({ x: 333.3, y: -71.9 });
    expect(x % GRID_SIZE).toBe(0);
    expect(Math.abs(y % GRID_SIZE)).toBe(0);
  });

  it("respeta un tamaño distinto al de por defecto", () => {
    expect(nodeOriginAt({ x: 248, y: 188 }, 480, 360)).toEqual({ x: 8, y: 8 });
  });
});
