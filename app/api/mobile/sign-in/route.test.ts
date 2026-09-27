import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Only Google's network verification and the database are faked. Nonces, rate
// limits, claim checks, token generation and hashing are the real code.
vi.mock("@/lib/db", () => ({ prisma: { apiToken: { create: vi.fn() } } }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn(), getActorEmail: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));
vi.mock("@/lib/google-id-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google-id-token")>()),
  verifyGoogleIdToken: vi.fn(),
}));

import { POST } from "./route";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { verifyGoogleIdToken } from "@/lib/google-id-token";
import { issueNonce, resetNonces } from "@/lib/mobile-nonce";
import { resetRateLimits } from "@/lib/rate-limit";
import { hashToken } from "@/lib/api-tokens";
import { MOBILE_TOKEN_DAYS } from "@/lib/mobile-auth";

const AUD = "348255215221-web.apps.googleusercontent.com";
const EMAIL = "bradlyls95@gmail.com"; // in lib/allowed-emails.ts

const verify = vi.mocked(verifyGoogleIdToken);
const create = vi.mocked(prisma.apiToken.create);

function claims(nonce: string, patch: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: AUD,
    sub: "g-123",
    email: EMAIL,
    email_verified: true,
    iat: now - 5,
    exp: now + 600,
    nonce,
    ...patch,
  };
}

function request(body: unknown, ip = "203.0.113.9") {
  return new NextRequest("http://localhost/api/mobile/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.1, ${ip}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const body = { id_token: "header.payload.signature", device_name: "Pixel 8" };

beforeEach(() => {
  resetNonces();
  resetRateLimits();
  vi.clearAllMocks();
  process.env.AUTH_GOOGLE_ID = AUD;
  create.mockImplementation((async ({ data }: { data: { name: string; token_prefix: string; expires_at: Date } }) => ({
    id: "tok-1",
    name: data.name,
    token_prefix: data.token_prefix,
    expires_at: data.expires_at,
  })) as never);
});

describe("POST /api/mobile/sign-in", () => {
  it("un token válido con un nonce emitido devuelve un token de API, una sola vez", async () => {
    const { nonce } = issueNonce();
    verify.mockResolvedValue(claims(nonce));

    const res = await POST(request(body));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.token).toMatch(/^tb_[A-Za-z0-9_-]{43}$/);
    expect(json.email).toBe(EMAIL);
    expect(json.name).toBe("mobile · Pixel 8");
    expect(res.headers.get("cache-control")).toBe("no-store");

    // Stored hashed, never raw; expiry as documented.
    const data = create.mock.calls[0][0].data as unknown as Record<string, unknown>;
    expect(data.token_hash).toBe(hashToken(json.token));
    expect(JSON.stringify(data)).not.toContain(json.token);
    const days = ((data.expires_at as Date).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(MOBILE_TOKEN_DAYS);

    // Audited with the verified Google account as the actor.
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({
      entity_type: "api_token",
      action: "create",
      actor_email: EMAIL,
    });

    // The verifier was asked for OUR web client as audience.
    expect(verify).toHaveBeenCalledWith(body.id_token, AUD);
  });

  it("rechaza reusar el mismo nonce (replay)", async () => {
    const { nonce } = issueNonce();
    verify.mockResolvedValue(claims(nonce));
    expect((await POST(request(body))).status).toBe(201);
    const again = await POST(request(body));
    expect(again.status).toBe(401);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rechaza un nonce que nunca emitimos", async () => {
    verify.mockResolvedValue(claims("inventado"));
    expect((await POST(request(body))).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rechaza lo que la verificación de firma no acepta", async () => {
    verify.mockRejectedValue(new Error("signature verification failed"));
    const res = await POST(request(body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign-in failed" });
  });

  it.each([
    ["audience de otra app", { aud: "otra.apps.googleusercontent.com" }, 401],
    ["issuer ajeno", { iss: "https://evil.example.com" }, 401],
    ["vencido", { exp: Math.floor(Date.now() / 1000) - 3600 }, 401],
    ["email sin verificar", { email_verified: false }, 401],
    ["cuenta fuera del allowlist", { email: "intruso@example.com" }, 403],
  ])("rechaza %s aunque la firma pase", async (_l, patch, status) => {
    const { nonce } = issueNonce();
    verify.mockResolvedValue(claims(nonce, patch));
    expect((await POST(request(body))).status).toBe(status);
    expect(create).not.toHaveBeenCalled();
  });

  it("un rechazo por allowlist no consume el nonce", async () => {
    const { nonce } = issueNonce();
    verify.mockResolvedValueOnce(claims(nonce, { email: "intruso@example.com" }));
    expect((await POST(request(body))).status).toBe(403);
    verify.mockResolvedValueOnce(claims(nonce));
    expect((await POST(request(body))).status).toBe(201);
  });

  it("un body mal formado es 400 y no llega a Google", async () => {
    expect((await POST(request("no es json"))).status).toBe(400);
    expect((await POST(request({ device_name: "x" }))).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("sin AUTH_GOOGLE_ID no hay sign-in (503), nunca una audiencia vacía", async () => {
    delete process.env.AUTH_GOOGLE_ID;
    expect((await POST(request(body))).status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });

  it("limita los intentos por IP (10 por minuto)", async () => {
    verify.mockRejectedValue(new Error("bad"));
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await POST(request(body, `198.51.100.${i}`))).status);
    // Distinct IPs: never limited by the per-IP cap.
    expect(statuses.every((s) => s === 401)).toBe(true);

    // Same IP, every attempt valid: no failure is recorded, so what stops the
    // 11th is the per-IP cap on attempts, not the failure budget.
    resetRateLimits();
    const sameIp = [];
    for (let i = 0; i < 11; i++) {
      verify.mockResolvedValueOnce(claims(issueNonce().nonce));
      sameIp.push((await POST(request(body, "192.0.2.1"))).status);
    }
    expect(sameIp.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(sameIp[10]).toBe(429);
  });

  it("tras 5 fallos desde una IP, bloquea aun con un token válido; otra IP sigue", async () => {
    verify.mockRejectedValue(new Error("bad"));
    for (let i = 0; i < 5; i++) expect((await POST(request(body))).status).toBe(401);

    const { nonce } = issueNonce();
    verify.mockResolvedValue(claims(nonce));
    const blocked = await POST(request(body));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    expect((await POST(request(body, "198.51.100.77"))).status).toBe(201);
  });
});
