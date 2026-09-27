import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { apiToken: { updateMany: vi.fn() } } }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireSession: vi.fn(),
  resolveActor: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { NextResponse } from "next/server";
import { POST } from "./route";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { requireSession, resolveActor } from "@/lib/api";

const updateMany = vi.mocked(prisma.apiToken.updateMany);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(null);
  updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("POST /api/mobile/sign-out", () => {
  it("un token se revoca a sí mismo, y solo a sí mismo", async () => {
    vi.mocked(resolveActor).mockResolvedValue({ kind: "token", id: "tok-1", label: "token:mobile · Pixel 8" });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const where = updateMany.mock.calls[0][0]!.where;
    expect(where).toEqual({ id: "tok-1", revoked_at: null });
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({ entity_id: "tok-1", action: "delete" });
  });

  it("una sesión web no puede usarlo: no tiene un token que revocar", async () => {
    vi.mocked(resolveActor).mockResolvedValue({ kind: "user", label: "owner@example.com" });
    expect((await POST()).status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("sin credencial devuelve lo que diga requireSession (401)", async () => {
    vi.mocked(requireSession).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    expect((await POST()).status).toBe(401);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("revocar dos veces es idempotente y no audita de nuevo", async () => {
    vi.mocked(resolveActor).mockResolvedValue({ kind: "token", id: "tok-1", label: "token:mobile · Pixel 8" });
    updateMany.mockResolvedValue({ count: 0 } as never);
    expect((await POST()).status).toBe(200);
    expect(auditLog).not.toHaveBeenCalled();
  });
});
