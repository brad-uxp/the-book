import { describe, it, expect } from "vitest";
import {
  canvasColor,
  isCanvasColor,
  CANVAS_COLORS,
  CANVAS_COLOR_KEYS,
  DEFAULT_CANVAS_COLOR,
} from "./canvas-palette";

describe("paleta del canvas", () => {
  it("todas las claves resuelven a un color", () => {
    for (const key of CANVAS_COLOR_KEYS) {
      expect(canvasColor(key).hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("el color por defecto está en la paleta", () => {
    expect(isCanvasColor(DEFAULT_CANVAS_COLOR)).toBe(true);
  });

  it("una clave desconocida cae al default en vez de romper el canvas", () => {
    // Una fila escrita antes de renombrar una entrada de la paleta tiene que
    // seguir dibujándose, aunque sea de otro color.
    expect(canvasColor("chartreuse")).toEqual(CANVAS_COLORS[DEFAULT_CANVAS_COLOR]);
    expect(canvasColor("")).toEqual(CANVAS_COLORS[DEFAULT_CANVAS_COLOR]);
  });

  it("no confunde propiedades heredadas con colores", () => {
    // canvasColor hace un lookup por clave: "toString" o "constructor" existen
    // en cualquier objeto y no deben pasar por colores válidos.
    expect(isCanvasColor("toString")).toBe(false);
    expect(isCanvasColor("constructor")).toBe(false);
    expect(canvasColor("toString")).toEqual(CANVAS_COLORS[DEFAULT_CANVAS_COLOR]);
  });

  it("los colores son distintos entre sí", () => {
    const hexes = CANVAS_COLOR_KEYS.map((k) => CANVAS_COLORS[k].hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});
