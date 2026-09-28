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

import { requireAppSession, requireReleaseToken, requireSession, requireSyncSession, requireUserSession } from "./api";
import { resetRateLimits } from "./rate-limit";

function withToken(kind: "mobile" | "automation" | "release") {
  const { token, prefix, hash } = generateToken();
  state.authorization = `Bearer ${token}`;
  state.record = { id: `tok-${kind}`, name: kind === "mobile" ? "mobile · Pixel" : kind === "release" ? "book-release" : "script", kind, token_prefix: prefix, token_hash: hash, expires_at: null, revoked_at: null };
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

// Quién llega a qué: el token de release solo publica versiones de la app.
describe("matriz de acceso por tipo de credencial", () => {
  const cases = [
    ["release", "requireSession (toda la API)", requireSession, 403],
    ["release", "requireSyncSession", requireSyncSession, 403],
    ["release", "requireAppSession (buscar actualización)", requireAppSession, 403],
    ["release", "requireUserSession (Settings)", requireUserSession, 403],
    ["release", "requireReleaseToken (publicar)", requireReleaseToken, null],
    ["mobile", "requireAppSession", requireAppSession, null],
    ["mobile", "requireReleaseToken", requireReleaseToken, 403],
    ["automation", "requireSession", requireSession, null],
    ["automation", "requireAppSession", requireAppSession, 403],
    ["automation", "requireReleaseToken", requireReleaseToken, 403],
  ] as const;

  it.each(cases)("token %s → %s → %s", async (kind, _label, guard, expected) => {
    withToken(kind);
    const res = await guard();
    expect(res === null ? null : res.status).toBe(expected);
  });

  it("la sesión del navegador busca actualizaciones pero no publica", async () => {
    state.session = { user: { email: "owner@example.com" } };
    expect(await requireAppSession()).toBeNull();
    expect((await requireReleaseToken())?.status).toBe(403);
  });

  it("sin credencial, publicar → 401", async () => {
    expect((await requireReleaseToken())?.status).toBe(401);
  });
});

