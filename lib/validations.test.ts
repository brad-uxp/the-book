import { describe, it, expect } from "vitest";
import { BulkDeleteIssuesSchema } from "./validations";

describe("BulkDeleteIssuesSchema", () => {
  it("acepta una lista de ids", () => {
    expect(BulkDeleteIssuesSchema.safeParse({ ids: ["a", "b"] }).success).toBe(
      true
    );
  });

  it("rechaza una lista vacía — borrar nada no es una operación", () => {
    expect(BulkDeleteIssuesSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it("rechaza un id vacío", () => {
    expect(BulkDeleteIssuesSchema.safeParse({ ids: [""] }).success).toBe(false);
  });

  it("acota el lote: 500 pasa, 501 no", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);
    expect(BulkDeleteIssuesSchema.safeParse({ ids: ids(500) }).success).toBe(true);
    expect(BulkDeleteIssuesSchema.safeParse({ ids: ids(501) }).success).toBe(false);
  });

  it("rechaza el body sin ids en vez de borrar por omisión", () => {
    expect(BulkDeleteIssuesSchema.safeParse({}).success).toBe(false);
    expect(BulkDeleteIssuesSchema.safeParse(undefined).success).toBe(false);
  });
});
