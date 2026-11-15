import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { apiToken: { create: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn(), getActorEmail: vi.fn(async () => "owner@example.com") }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireUserSession: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { NextRequest } from "next/server";
import { POST } from "./route";
import { prisma } from "@/lib/db";
import { requireUserSession } from "@/lib/api";
import { hashToken, storedHashOf } from "@/lib/api-tokens";

const create = vi.mocked(prisma.apiToken.create);

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/settings/tokens", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserSession).mockResolvedValue(null);
  create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ id: "tok-1", ...data })) as never);
});

describe("POST /api/settings/tokens", () => {
  it("crea un token readonly, que dura lo de siempre", async () => {
    const res = await post({ name: "fin-cli", kind: "readonly" });
    expect(res.status).toBe(201);
    const data = create.mock.calls[0][0].data;
    expect(data.kind).toBe("readonly");
    expect((data.expires_at as Date).getTime() - Date.now()).toBeGreaterThan(89 * 24 * 3600 * 1000);
    // Su propia cabeza: proxy.ts le corta las escrituras antes del handler.
    const body = await res.json();
    expect(body.token).toMatch(/^tbro_/);
    expect(data.token_prefix).toBe(body.token.slice(0, 13));
    // Guarda el hash con dominio: un build anterior no lo verifica (lib/readonly-token.ts).
    expect(data.token_hash).toBe(storedHashOf(body.token, "readonly"));
    expect(data.token_hash).not.toBe(hashToken(body.token));
  });

  // Un build anterior a ApiToken.kind le da a todo token que verifica el
  // alcance del dueño: el hash de un release o un agent no es el sha256 solo,
  // así que ahí no verifica (lib/api-tokens.ts).
  it.each(["release", "agent"] as const)("guarda el hash de un token %s con su dominio", async (kind) => {
    const res = await post({ name: "x", kind, expires_in_days: 7 });
    expect(res.status).toBe(201);
    const body = await res.json();
    const data = create.mock.calls[0][0].data;
    expect(body.token).toMatch(/^tb_/);
    expect(data.token_hash).toBe(storedHashOf(body.token, kind));
    expect(data.token_hash).not.toBe(hashToken(body.token));
  });

  it("un token readonly dura 90 días como mucho", async () => {
    expect((await post({ name: "fin-cli", kind: "readonly", expires_in_days: 90 })).status).toBe(201);
    const res = await post({ name: "fin-cli", kind: "readonly", expires_in_days: 91 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fieldErrors.expires_in_days[0]).toMatch(/90 days/);
    // Los de automatización siguen pudiendo durar un año.
    expect((await post({ name: "script", expires_in_days: 365 })).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("sin kind sigue siendo automation, con tb_", async () => {
    const res = await post({ name: "script" });
    expect(create.mock.calls[0][0].data.kind).toBe("automation");
    expect((await res.json()).token).toMatch(/^tb_/);
  });

  it("mobile no se emite acá, ni un kind inventado", async () => {
    for (const kind of ["mobile", "admin"]) {
      expect((await post({ name: "x", kind })).status).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });
});
