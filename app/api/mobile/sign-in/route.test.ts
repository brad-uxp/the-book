import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Only Google's network verification and the database are faked. Nonces,
// claim checks, the body cap, token generation and hashing are the real code.
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
import { issueNonce as issueNonceWith, resetUsedNonces } from "@/lib/mobile-nonce";
import { hashToken } from "@/lib/api-tokens";
import { MOBILE_TOKEN_DAYS } from "@/lib/mobile-auth";

const AUD = "348255215221-web.apps.googleusercontent.com";
const ANDROID = "348255215221-release.apps.googleusercontent.com";
const SECRET = "route-test-secret";
const issueNonce = () => issueNonceWith(SECRET);
const EMAIL = "bradlyls95@gmail.com"; // in lib/allowed-emails.ts

const verify = vi.mocked(verifyGoogleIdToken);
const create = vi.mocked(prisma.apiToken.create);

function claims(nonce: string, patch: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: AUD,
    azp: ANDROID,
    sub: "g-123",
    email: EMAIL,
    email_verified: true,
    iat: now - 5,
    exp: now + 600,
    nonce,
    ...patch,
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/mobile/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1, 203.0.113.9" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const body = { id_token: "header.payload.signature", device_name: "Pixel 8" };

beforeEach(() => {
  resetUsedNonces();
  vi.clearAllMocks();
  process.env.AUTH_GOOGLE_ID = AUD;
  process.env.AUTH_SECRET = SECRET;
  process.env.MOBILE_ANDROID_CLIENT_ID = ANDROID;
  delete process.env.MOBILE_ANDROID_DEBUG_CLIENT_ID;
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

  it("rechaza un nonce que nunca emitimos, o firmado con otro secreto", async () => {
    verify.mockResolvedValue(claims(issueNonceWith("otro-secreto").nonce));
    expect((await POST(request(body))).status).toBe(401);
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
    ["pedido por otro cliente del proyecto (azp)", { azp: "348255215221-otro.apps.googleusercontent.com" }, 401],
    ["pedido por el cliente de debug en producción", { azp: "348255215221-debug.apps.googleusercontent.com" }, 401],
    ["issuer ajeno", { iss: "https://evil.example.com" }, 401],
    ["vencido", { exp: Math.floor(Date.now() / 1000) - 3600 }, 401],
    ["email sin verificar", { email_verified: false }, 401],
    ["cuenta fuera del allowlist", { email: "intruso@example.com" }, 403],
    // Entra a la web, pero no desde el teléfono: su dominio (Workspace) tiene
    // administradores que pueden resetearla.
    ["cuenta de la web que no puede usar el teléfono", { email: "brad@uxprogramming.com" }, 403],
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

  it("un body de más de 8 KB es 413 sin leerse entero, aunque no declare su tamaño", async () => {
    const big = JSON.stringify({ id_token: "x".repeat(20_000) });
    expect((await POST(request(big))).status).toBe(413);

    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024)));
        c.close();
      },
    });
    const chunked = new NextRequest("http://localhost/api/mobile/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as never);
    expect((await POST(chunked)).status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });

  it("un device_name largo, vacío o ausente se ordena en vez de rechazar", async () => {
    for (const [device, name] of [
      ["x".repeat(100), `mobile · ${"x".repeat(40)}`],
      ["   ", "mobile · Android"],
      [undefined, "mobile · Android"],
    ] as const) {
      verify.mockResolvedValueOnce(claims(issueNonce().nonce));
      const res = await POST(request({ id_token: body.id_token, device_name: device }));
      expect(res.status).toBe(201);
      expect((await res.json()).name).toBe(name);
    }
  });

  it.each([
    ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_ID"],
    ["AUTH_SECRET", "AUTH_SECRET"],
    ["el cliente Android autorizado", "MOBILE_ANDROID_CLIENT_ID"],
  ])("sin %s no hay sign-in (503): falla cerrado", async (_l, key) => {
    delete process.env[key];
    expect((await POST(request(body))).status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });

  it("no limita por IP: muchos rechazos no le cierran la puerta al dueño", async () => {
    verify.mockRejectedValue(new Error("bad"));
    for (let i = 0; i < 100; i++) expect((await POST(request(body))).status).toBe(401);
    verify.mockReset();
    verify.mockResolvedValue(claims(issueNonce().nonce));
    expect((await POST(request(body))).status).toBe(201);
  });
});
