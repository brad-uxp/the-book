import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateToken } from "./api-tokens";

// La cadena real — encabezado → tabla de tokens → tipo del token — con la
// base, los encabezados y la sesión simulados.
const state = vi.hoisted(() => ({
  authorization: null as string | null,
  record: null as unknown,
  session: null as unknown,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: {
      findUnique: vi.fn(async () => state.record),
      update: vi.fn(async () => ({})),
    },
  },
}));
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => state.session),
  isAllowedSession: (s: unknown) => !!s,
}));

import { requireSyncSession } from "./api";
import { resetRateLimits } from "./rate-limit";

function withToken(kind: "mobile" | "automation") {
  const { token, prefix, hash } = generateToken();
  state.authorization = `Bearer ${token}`;
  state.record = { id: `tok-${kind}`, name: kind === "mobile" ? "mobile · Pixel" : "script", kind, token_prefix: prefix, token_hash: hash, expires_at: null, revoked_at: null };
}

beforeEach(() => {
  resetRateLimits();
  state.authorization = null;
  state.record = null;
  state.session = null;
});

describe("requireSyncSession", () => {
  it("el token del teléfono pasa", async () => {
    withToken("mobile");
    expect(await requireSyncSession()).toBeNull();
  });

  it("un token de automatización → 403: la sync no es para scripts", async () => {
    withToken("automation");
    const res = await requireSyncSession();
    expect(res?.status).toBe(403);
  });

  it("la sesión del navegador pasa", async () => {
    state.session = { user: { email: "owner@example.com" } };
    expect(await requireSyncSession()).toBeNull();
  });

  it("sin credencial → 401", async () => {
    expect((await requireSyncSession())?.status).toBe(401);
  });
});
