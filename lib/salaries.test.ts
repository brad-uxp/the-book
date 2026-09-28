import { describe, it, expect } from "vitest";
import { wasPaidForMonth } from "./salaries";

const pay = (due: string) => ({ due_date: `${due}T00:00:00.000Z` });

describe("wasPaidForMonth", () => {
  it("cuenta un pago cuyo vencimiento cae en el mes", () => {
    expect(wasPaidForMonth([pay("2026-09-05")], "2026-09")).toBe(true);
  });

  it("sin pagos del mes, no cobró", () => {
    expect(wasPaidForMonth([pay("2026-08-05")], "2026-09")).toBe(false);
    expect(wasPaidForMonth([], "2026-09")).toBe(false);
  });

  it("un pago adelantado del mes siguiente no esconde el de este mes", () => {
    // Ordenados como los trae la página: el más nuevo primero.
    expect(wasPaidForMonth([pay("2026-10-05"), pay("2026-09-05")], "2026-09")).toBe(true);
  });

  it("un vencimiento el día 1 es de ese mes, aunque en Montevideo sea la noche anterior", () => {
    expect(wasPaidForMonth([pay("2026-09-01")], "2026-09")).toBe(true);
    expect(wasPaidForMonth([pay("2026-09-01")], "2026-08")).toBe(false);
  });
});
