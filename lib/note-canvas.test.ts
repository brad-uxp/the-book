import { describe, it, expect } from "vitest";
import { GRID_SIZE } from "./canvas-geometry";
import {
  DUPLICATE_OFFSET,
  NODE_DEFAULT_HEIGHT,
  NODE_DEFAULT_WIDTH,
  copyIdeas,
  nodeOriginAt,
  repointConnections,
  type CanvasIdea,
} from "./note-canvas";

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

describe("copyIdeas", () => {
  const idea = (id: string, x: number, y: number): CanvasIdea => ({
    id, content: `<p>${id}</p>`, color: "blue", x, y, width: 320, height: 96,
  });
  let n = 0;
  const newId = () => `copy-${++n}`;

  it("copia texto, color y tamaño con un id nuevo, donde se le pide", () => {
    n = 0;
    const [copy] = copyIdeas([idea("a", 0, 0)], () => ({ x: 400, y: 160 }), newId);
    expect(copy).toEqual({ id: "copy-1", content: "<p>a</p>", color: "blue", x: 400, y: 160, width: 320, height: 96 });
  });

  it("⌘D: cada copia desplazada 24 px en diagonal, sobre la grilla", () => {
    n = 0;
    const copies = copyIdeas(
      [idea("a", 0, 0), idea("b", 403, 101)],
      (i) => ({ x: i.x + DUPLICATE_OFFSET, y: i.y + DUPLICATE_OFFSET }),
      newId
    );
    expect(copies.map((c) => [c.id, c.x, c.y])).toEqual([["copy-1", 24, 24], ["copy-2", 424, 128]]);
    expect(copies.every((c) => c.x % GRID_SIZE === 0 && c.y % GRID_SIZE === 0)).toBe(true);
  });

  it("no toca los originales", () => {
    const originals = [idea("a", 0, 0)];
    copyIdeas(originals, () => ({ x: 8, y: 8 }), newId);
    expect(originals[0]).toEqual(idea("a", 0, 0));
  });
});

describe("repointConnections", () => {
  const edges = [
    { id: "1", source: "a", target: "b" },
    { id: "2", source: "c", target: "a" },
    { id: "3", source: "c", target: "d" },
  ];

  it("mueve los extremos indicados y deja el resto", () => {
    const out = repointConnections(edges, new Map([["a", "ghost-a"]]));
    expect(out.map((e) => [e.id, e.source, e.target])).toEqual([
      ["1", "ghost-a", "b"], ["2", "c", "ghost-a"], ["3", "c", "d"],
    ]);
    expect(out[2]).toBe(edges[2]);
  });

  it("ida y vuelta devuelve las mismas conexiones", () => {
    const there = repointConnections(edges, new Map([["a", "g"], ["c", "h"]]));
    const back = repointConnections(there, new Map([["g", "a"], ["h", "c"]]));
    expect(back).toEqual(edges);
  });
});
