import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/oauth-service", () => ({
  exchangeCode: vi.fn(async () => ({ ok: true, tokens: { access_token: "tb_x", token_type: "Bearer", expires_in: 3600, refresh_token: "tbr_y", scope: "issues" } })),
  refreshTokens: vi.fn(async () => ({ ok: false, error: "invalid_grant", description: "Refresh token reused" })),
}));

import { POST } from "./route";
import { exchangeCode } from "@/lib/oauth-service";
import { resetRateLimits } from "@/lib/rate-limit";

const post = (body: string, type = "application/x-www-form-urlencoded") =>
  POST(new NextRequest("https://book.bolstro.com/api/oauth/token", { method: "POST", headers: { "content-type": type }, body }));

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
});

describe("POST /api/oauth/token", () => {
  it("canjea un código, sin caché", async () => {
    const res = await post("grant_type=authorization_code&code=tbc_a&code_verifier=" + "v".repeat(43) + "&redirect_uri=http%3A%2F%2Flocalhost%3A1%2Fcallback&client_id=https%3A%2F%2Fclaude.ai%2Fx");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ code: "tbc_a", redirect_uri: "http://localhost:1/callback" }));
  });

  it("un refresh rechazado: 400 invalid_grant, como pide RFC 6749", async () => {
    const res = await post("grant_type=refresh_token&refresh_token=tbr_old&client_id=https%3A%2F%2Fclaude.ai%2Fx");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant", error_description: "Refresh token reused" });
  });

  it("un parámetro repetido: invalid_request (RFC 6749 §3.2), no el último", async () => {
    const res = await post("grant_type=refresh_token&refresh_token=tbr_a&refresh_token=tbr_b&client_id=x");
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("JSON en vez de formulario, un grant desconocido o campos faltantes: 400 sin tocar el servicio", async () => {
    expect((await post('{"grant_type":"authorization_code"}', "application/json")).status).toBe(400);
    expect(await (await post("grant_type=client_credentials")).json()).toMatchObject({ error: "unsupported_grant_type" });
    expect(await (await post("grant_type=authorization_code&code=tbc_a")).json()).toMatchObject({ error: "invalid_request" });
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});
