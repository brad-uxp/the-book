import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/push", () => ({ pushToToken: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireSession: vi.fn(),
  resolveActor: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { POST } from "./route";
import { requireSession, resolveActor } from "@/lib/api";
import { pushToToken } from "@/lib/push";

const post = (body?: unknown) =>
  POST(
    new Request("http://x/api/mobile/devices/test", {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(null);
  vi.mocked(resolveActor).mockResolvedValue({ kind: "token", id: "tok-phone", label: "token:mobile", tokenKind: "mobile" });
});
afterEach(() => vi.useRealTimers());

describe("POST /api/mobile/devices/test", () => {
  it("manda un push de prueba al teléfono que lo pide, y solo a ese", async () => {
    vi.mocked(pushToToken).mockResolvedValue({ sent: 1, removed: 0, failed: 0 });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "sent" });
    expect(pushToToken).toHaveBeenCalledWith("tok-phone", { kind: "test" });
  });

  it.each([
    ["sin dispositivo registrado", "no_device" as const, 409, "no_device"],
    ["push sin configurar en el servidor", { sent: 0, removed: 0, failed: 0, off: true as const }, 503, "not_configured"],
    ["FCM ya no conoce el token", { sent: 0, removed: 1, failed: 0 }, 410, "unregistered"],
    ["FCM falló", { sent: 0, removed: 0, failed: 1 }, 502, "failed"],
  ])("%s", async (_label, outcome, status, text) => {
    vi.mocked(pushToToken).mockResolvedValue(outcome);
    const res = await post({});
    expect(res.status).toBe(status);
    expect((await res.json()).status).toBe(text);
  });

  it("con demora: responde enseguida y manda después", async () => {
    vi.useFakeTimers();
    vi.mocked(pushToToken).mockResolvedValue({ sent: 1, removed: 0, failed: 0 });
    const res = await post({ delay_seconds: 10 });
    expect(res.status).toBe(202);
    expect(pushToToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pushToToken).toHaveBeenCalledWith("tok-phone", { kind: "test" });
  });

  it("la demora tiene tope: 60 s", async () => {
    expect((await post({ delay_seconds: 3600 })).status).toBe(400);
    expect(pushToToken).not.toHaveBeenCalled();
  });

  it("solo el token del teléfono", async () => {
    vi.mocked(resolveActor).mockResolvedValue({ kind: "token", id: "tok-bot", label: "token:agent", tokenKind: "automation" });
    expect((await post()).status).toBe(403);
    expect(pushToToken).not.toHaveBeenCalled();
  });
});
