import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  mobileDevice: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

const sends = vi.hoisted(() => ({ results: [] as string[], calls: [] as unknown[] }));
vi.mock("@/lib/fcm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fcm")>()),
  parseServiceAccount: (raw: string | undefined) => (raw ? { project_id: "p", client_email: "e", private_key: "k", token_uri: "t" } : null),
  createFcmClient: () => ({
    send: async (token: string, data: unknown) => {
      sends.calls.push({ token, data });
      const r = sends.results.shift() ?? "sent";
      if (r === "throw") throw new Error("network down");
      return r;
    },
  }),
}));

import { forgetDevice, pushToAll, pushToToken, registerDevice, resetPushClient } from "./push";

beforeEach(() => {
  vi.clearAllMocks();
  sends.results = [];
  sends.calls = [];
  process.env.FCM_SERVICE_ACCOUNT_JSON = "{configured}";
  resetPushClient();
  db.mobileDevice.delete.mockResolvedValue({});
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe("pushToAll", () => {
  it("manda a cada teléfono vivo y borra los que FCM ya no conoce", async () => {
    db.mobileDevice.findMany.mockResolvedValue([
      { id: "d1", fcm_token: "t1" },
      { id: "d2", fcm_token: "t2" },
      { id: "d3", fcm_token: "t3" },
      { id: "d4", fcm_token: "t4" },
    ]);
    sends.results = ["sent", "unregistered", "failed", "throw"];
    const outcome = await pushToAll({ kind: "notification", id: "n1" });
    expect(outcome).toEqual({ sent: 1, removed: 1, failed: 2 });
    expect(db.mobileDevice.delete).toHaveBeenCalledTimes(1);
    expect(db.mobileDevice.delete).toHaveBeenCalledWith({ where: { id: "d2" } });
  });

  it("solo a teléfonos cuyo token sigue vivo: móvil, sin revocar, sin vencer", async () => {
    db.mobileDevice.findMany.mockResolvedValue([]);
    await pushToAll({ kind: "test" });
    const where = db.mobileDevice.findMany.mock.calls[0][0].where;
    expect(where.api_token.kind).toBe("mobile");
    expect(where.api_token.revoked_at).toBeNull();
    expect(where.api_token.OR[0]).toEqual({ expires_at: null });
    expect(where.api_token.OR[1].expires_at.gt).toBeInstanceOf(Date);
  });

  it("sin FCM configurado: no manda nada y lo dice", async () => {
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    resetPushClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db.mobileDevice.findMany.mockResolvedValue([{ id: "d1", fcm_token: "t1" }]);
    expect(await pushToAll({ kind: "test" })).toEqual({ sent: 0, removed: 0, failed: 0, off: true });
    expect(sends.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("pushToToken", () => {
  it("sin dispositivo: no_device", async () => {
    db.mobileDevice.findFirst.mockResolvedValue(null);
    expect(await pushToToken("tok", { kind: "test" })).toBe("no_device");
  });
});

describe("registerDevice", () => {
  it("un token de FCM se muda al token de API que lo registra; uno por token de API", async () => {
    db.mobileDevice.upsert.mockResolvedValue({ id: "d1" });
    await registerDevice({ apiTokenId: "tok-new", fcmToken: "fcm-1", platform: "android", appVersion: "0.5.0" });
    expect(db.mobileDevice.deleteMany).toHaveBeenCalledWith({
      where: { fcm_token: "fcm-1", NOT: { api_token_id: "tok-new" } },
    });
    const args = db.mobileDevice.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ api_token_id: "tok-new" });
    expect(args.update.fcm_token).toBe("fcm-1");
    expect(args.update.last_seen_at).toBeInstanceOf(Date);
  });
});

describe("forgetDevice", () => {
  it("borra el dispositivo de ese token", async () => {
    db.mobileDevice.deleteMany.mockResolvedValue({ count: 1 });
    expect(await forgetDevice("tok")).toBe(1);
    expect(db.mobileDevice.deleteMany).toHaveBeenCalledWith({ where: { api_token_id: "tok" } });
  });
});
