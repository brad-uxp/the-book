import { describe, it, expect } from "vitest";
import { formatCents, parseToCents, centsToDecimalString } from "./currency";

describe("formatCents", () => {
  it("formats cents as USD", () => {
    expect(formatCents(1050)).toBe("$10.50");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(100)).toBe("$1.00");
  });

  it("formats negative amounts", () => {
    expect(formatCents(-2599)).toBe("-$25.99");
  });

  it("redondea entradas no enteras en vez de arrastrar decimales de centavo", () => {
    expect(formatCents(1050.5)).toBe("$10.51");
    expect(formatCents(1050.4)).toBe("$10.50");
  });
});

describe("parseToCents — formatos válidos", () => {
  it("parsea decimales simples", () => {
    expect(parseToCents("10.50")).toBe(1050);
    expect(parseToCents("0.05")).toBe(5);
    expect(parseToCents("7")).toBe(700);
    expect(parseToCents(".5")).toBe(50);
  });

  it("acepta símbolo de moneda y espacios", () => {
    expect(parseToCents("$10.50")).toBe(1050);
    expect(parseToCents("  10.50  ")).toBe(1050);
    expect(parseToCents("$ 1 234.56")).toBe(123456);
  });

  it("acepta separador de miles estilo US", () => {
    expect(parseToCents("$1,234.56")).toBe(123456);
    expect(parseToCents("1,234")).toBe(123400);
    expect(parseToCents("12,345,678.90")).toBe(1234567890);
  });

  it("acepta formato europeo, que es el que se tipea en Uruguay", () => {
    // El último separador manda: si la coma va al final, es el decimal.
    expect(parseToCents("1.234,56")).toBe(123456);
    expect(parseToCents("1,50")).toBe(150);
    expect(parseToCents("1.234.567,89")).toBe(123456789);
  });

  it("maneja negativos", () => {
    expect(parseToCents("-10.50")).toBe(-1050);
    expect(parseToCents("-$10.50")).toBe(-1050);
    expect(parseToCents("−10.50")).toBe(-1050); // minus unicode
  });
});

describe("parseToCents — redondeo exacto, sin float drift", () => {
  it("redondea medio centavo hacia arriba (el caso que fallaba)", () => {
    // Math.round(1.005 * 100) da 100 por representación binaria: debe ser 101.
    expect(parseToCents("1.005")).toBe(101);
    expect(parseToCents("8.115")).toBe(812);
    expect(parseToCents("2.675")).toBe(268);
  });

  it("redondea hacia abajo por debajo de medio centavo", () => {
    expect(parseToCents("1.004")).toBe(100);
    expect(parseToCents("19.994")).toBe(1999);
  });

  it("mantiene los casos ya cubiertos", () => {
    expect(parseToCents("0.1")).toBe(10);
    expect(parseToCents("19.999")).toBe(2000);
  });

  it("no pierde precisión en montos grandes", () => {
    expect(parseToCents("999999.99")).toBe(99999999);
  });

  it("redondea negativos alejándose de cero", () => {
    expect(parseToCents("-1.005")).toBe(-101);
  });
});

describe("parseToCents — entrada inválida devuelve 0, nunca un monto inventado", () => {
  it.each([
    ["", "vacío"],
    ["   ", "solo espacios"],
    ["abc", "letras"],
    ["1e3", "notación exponencial"],
    ["1-2", "guion interno"],
    ["1.2.3", "múltiples puntos sin agrupar"],
    ["--5", "doble signo"],
    ["1,2,3", "comas inconsistentes"],
    ["10.5.6", "decimales ambiguos"],
    ["$", "solo símbolo"],
    ["NaN", "NaN literal"],
    ["Infinity", "Infinity"],
  ])("parseToCents(%j) === 0 (%s)", (input) => {
    expect(parseToCents(input)).toBe(0);
  });
});

describe("centsToDecimalString", () => {
  it("renders a two-decimal string for input fields", () => {
    expect(centsToDecimalString(1050)).toBe("10.50");
    expect(centsToDecimalString(5)).toBe("0.05");
  });

  it("hace round-trip con parseToCents", () => {
    for (const cents of [0, 1, 5, 99, 100, 1050, -2599, 99999999]) {
      expect(parseToCents(centsToDecimalString(cents))).toBe(cents);
    }
  });
});
