import { describe, it, expect } from "vitest";
import {
  labelColor,
  isLabelColor,
  LABEL_COLORS,
  LABEL_COLOR_KEYS,
  DEFAULT_LABEL_COLOR,
} from "./canvas-labels";

describe("paleta de chips", () => {
  it("todas las claves resuelven a un color", () => {
    for (const key of LABEL_COLOR_KEYS) {
      expect(labelColor(key).hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("el color por defecto está en la paleta", () => {
    expect(isLabelColor(DEFAULT_LABEL_COLOR)).toBe(true);
  });

  it("una clave desconocida cae al default en vez de romper el canvas", () => {
    // Una fila escrita antes de renombrar una entrada de la paleta tiene que
    // seguir dibujándose, aunque sea de otro color.
    expect(labelColor("chartreuse")).toEqual(LABEL_COLORS[DEFAULT_LABEL_COLOR]);
    expect(labelColor("")).toEqual(LABEL_COLORS[DEFAULT_LABEL_COLOR]);
  });

  it("no confunde propiedades heredadas con colores", () => {
    // labelColor hace un lookup por clave: "toString" o "constructor" existen
    // en cualquier objeto y no deben pasar por colores válidos.
    expect(isLabelColor("toString")).toBe(false);
    expect(isLabelColor("constructor")).toBe(false);
    expect(labelColor("toString")).toEqual(LABEL_COLORS[DEFAULT_LABEL_COLOR]);
  });

  it("los colores son distintos entre sí", () => {
    const hexes = LABEL_COLOR_KEYS.map((k) => LABEL_COLORS[k].hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});
