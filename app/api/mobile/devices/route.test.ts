import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/push", () => ({ registerDevice: vi.fn(), forgetDevice: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireSession: vi.fn(),
  resolveActor: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { NextResponse } from "next/server";
import { DELETE, POST } from "./route";
import { requireSession, resolveActor, type Actor } from "@/lib/api";
import { forgetDevice, registerDevice } from "@/lib/push";

const TOKEN = "cM7dQwX0Rk2:APA91bH-example_fcm_registration_token_1234567890";

const mobile: Actor = { kind: "token", id: "tok-phone", label: "token:mobile · Redmi", tokenKind: "mobile" };
const automation: Actor = { kind: "token", id: "tok-bot", label: "token:agent", tokenKind: "automation" };
// The in-app updater adds a `release` kind; it must not reach devices either.
const release = { kind: "token", id: "tok-rel", label: "token:release", tokenKind: "release" } as unknown as Actor;
const browser: Actor = { kind: "user", label: "owner@example.com" };

const post = (body: unknown) =>
  POST(new Request("http://x/api/mobile/devices", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(null);
  vi.mocked(registerDevice).mockResolvedValue({ id: "dev-1" });
  vi.mocked(forgetDevice).mockResolvedValue(1);
});

describe("POST /api/mobile/devices", () => {
  it("el token del teléfono registra su token de FCM", async () => {
    vi.mocked(resolveActor).mockResolvedValue(mobile);
    const res = await post({ fcm_token: TOKEN, platform: "android", app_version: "0.5.0" });
    expect(res.status).toBe(200);
    expect(registerDevice).toHaveBeenCalledWith({
      apiTokenId: "tok-phone",
      fcmToken: TOKEN,
      platform: "android",
      appVersion: "0.5.0",
    });
  });

  it("sin credencial: 401", async () => {
    vi.mocked(requireSession).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await post({ fcm_token: TOKEN, platform: "android" })).status).toBe(401);
    expect(registerDevice).not.toHaveBeenCalled();
  });

  it.each([
    ["un token de automatización", automation],
    ["un token de release", release],
    ["la sesión del navegador (no tiene dispositivo)", browser],
  ])("%s: 403", async (_label, actor) => {
    vi.mocked(resolveActor).mockResolvedValue(actor);
    expect((await post({ fcm_token: TOKEN, platform: "android" })).status).toBe(403);
    expect(registerDevice).not.toHaveBeenCalled();
  });

  it.each([
    ["sin token", { platform: "android" }],
    ["token corto", { fcm_token: "abc", platform: "android" }],
    ["token con espacios", { fcm_token: `${TOKEN} x`, platform: "android" }],
    ["otra plataforma", { fcm_token: TOKEN, platform: "ios" }],
    ["versión rara", { fcm_token: TOKEN, platform: "android", app_version: "1.0; drop" }],
    ["campos de más", { fcm_token: TOKEN, platform: "android", api_token_id: "otro" }],
  ])("%s: 400", async (_label, body) => {
    vi.mocked(resolveActor).mockResolvedValue(mobile);
    expect((await post(body)).status).toBe(400);
    expect(registerDevice).not.toHaveBeenCalled();
  });

  it("un cuerpo enorme se corta antes de leerlo: 413", async () => {
    vi.mocked(resolveActor).mockResolvedValue(mobile);
    expect((await post({ fcm_token: "a".repeat(20_000), platform: "android" })).status).toBe(413);
  });
});

describe("DELETE /api/mobile/devices", () => {
  it("el teléfono deja de recibir push", async () => {
    vi.mocked(resolveActor).mockResolvedValue(mobile);
    expect((await DELETE()).status).toBe(200);
    expect(forgetDevice).toHaveBeenCalledWith("tok-phone");
  });

  it("otra credencial no puede borrar el dispositivo del teléfono", async () => {
    vi.mocked(resolveActor).mockResolvedValue(automation);
    expect((await DELETE()).status).toBe(403);
    expect(forgetDevice).not.toHaveBeenCalled();
  });
});
