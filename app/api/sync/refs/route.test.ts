import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    client: { findMany: vi.fn(async () => [{ id: "c1", name: "ACME", color_hex: "#000000" }]) },
    person: { findMany: vi.fn(async () => [{ id: "p1", name: "Ana", status: "active", role: { name: "Dev" } }]) },
    invoice: {
      findMany: vi.fn(async () => [
        { id: "i1", invoice_number: "F-1", status: "sent", amount_cents: 100_000, client: { name: "ACME" } },
      ]),
    },
  },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireSyncSession: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn(), getActorEmail: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { GET } from "./route";
import { prisma } from "@/lib/db";
import { requireSyncSession } from "@/lib/api";

beforeEach(() => {
  vi.mocked(requireSyncSession).mockResolvedValue(null);
});

describe("GET /api/sync/refs", () => {
  it("sin credencial no lee nada", async () => {
    vi.mocked(requireSyncSession).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await GET()).status).toBe(401);
  });

  it("las facturas llevan su total y nada de lo que cobra la comisión (el teléfono lo guarda en claro)", async () => {
    const body = await (await GET()).json();
    expect(body.invoices).toEqual([
      { id: "i1", invoice_number: "F-1", client_name: "ACME", status: "sent", amount_cents: 100_000 },
    ]);
    const select = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]?.select ?? {};
    expect(select).not.toHaveProperty("fee_cents");
    expect(body.people).toEqual([{ id: "p1", name: "Ana", role: "Dev", status: "active" }]);
  });
});
