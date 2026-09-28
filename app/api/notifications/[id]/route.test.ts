import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { notification: { findUnique: vi.fn() } } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireSession: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { NextResponse } from "next/server";
import { GET } from "./route";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api";

const get = (id: string) => GET(new Request(`http://x/api/notifications/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(null);
});

describe("GET /api/notifications/:id", () => {
  it("devuelve el título y el texto que el push no lleva", async () => {
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: "n1",
      title: "Invoice due: Avatar",
      body: "Invoice #12 of $1,200.00 is due today.",
      entity_type: "invoice",
      entity_id: "inv-1",
    } as never);
    const res = await get("n1");
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Invoice due: Avatar");
  });

  it("no existe: 404", async () => {
    vi.mocked(prisma.notification.findUnique).mockResolvedValue(null);
    expect((await get("nope")).status).toBe(404);
  });

  it("sin credencial: 401", async () => {
    vi.mocked(requireSession).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await get("n1")).status).toBe(401);
    expect(prisma.notification.findUnique).not.toHaveBeenCalled();
  });
});
