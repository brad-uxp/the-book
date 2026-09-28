import { describe, it, expect } from "vitest";
import { awaitingOf, invoiceNetCents, isPastDue } from "./invoices";
import * as metrics from "./metrics";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("lib/invoices (compartido con la app)", () => {
  it("el neto es el monto más la comisión, que se guarda negativa", () => {
    expect(invoiceNetCents({ amount_cents: 1000, fee_cents: -150 })).toBe(850);
  });

  it("awaitingOf acepta vencimientos como string ISO, como los guarda el teléfono", () => {
    const a = awaitingOf(
      [
        { status: "sent", amount_cents: 1000, fee_cents: -100, due_date: "2026-08-31T00:00:00.000Z" },
        { status: "sent", amount_cents: 500, fee_cents: 0, due_date: "2026-09-30T00:00:00.000Z" },
        { status: "pending", amount_cents: 700, fee_cents: 0, due_date: "2026-07-31T00:00:00.000Z" },
      ],
      day(2026, 9, 10)
    );
    expect(a).toEqual({ count: 2, netCents: 1400, pastDueCount: 1 });
  });

  it("lib/metrics sigue exponiendo las mismas funciones (el dashboard y la web las importan de ahí)", () => {
    expect(metrics.isPastDue).toBe(isPastDue);
    expect(metrics.awaitingOf).toBe(awaitingOf);
  });
});
