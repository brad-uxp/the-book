import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateToken, hashToken, READONLY_REFUSAL, type TokenKind } from "./api-tokens";

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

import { getWriter, mcpBudgetKey, requireAppSession, requireReleaseToken, requireSession, requireSyncSession, requireUserSession } from "./api";
import { resetRateLimits } from "./rate-limit";

const TOKEN_NAMES = { mobile: "mobile · Pixel", automation: "script", release: "book-release", agent: "claude-agent", readonly: "fin-cli" } as const;

/**
 * Presents a token of `kind`. A kind the build does not know — as after a
 * rollback to a build older than the kind — gets a `tb_` token and its name.
 */
function withToken(kind: keyof typeof TOKEN_NAMES | (string & {})) {
  const known = Object.hasOwn(TOKEN_NAMES, kind);
  const { token, prefix, hash } = generateToken(known ? (kind as TokenKind) : undefined);
  state.authorization = `Bearer ${token}`;
  const name = known ? TOKEN_NAMES[kind as keyof typeof TOKEN_NAMES] : kind;
  state.record = { id: `tok-${kind}`, name, kind, token_prefix: prefix, token_hash: hash, expires_at: null, revoked_at: null };
}

/** The request a handler hands to requireSession({ readonly: req }). */
const asked = (method: string) => new Request("http://localhost/api/invoices", { method });

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
    // Un agente solo llega a las rutas de issues, que lo piden explícitamente.
    ["agent", "requireSession (toda la API)", requireSession, 403],
    ["agent", "requireSession({ agent: true }) (issues)", () => requireSession({ agent: true }), null],
    ["agent", "requireSyncSession", requireSyncSession, 403],
    ["agent", "requireAppSession", requireAppSession, 403],
    ["agent", "requireUserSession (Settings, tokens)", requireUserSession, 403],
    ["agent", "requireReleaseToken", requireReleaseToken, 403],
    ["release", "requireSession({ agent: true })", () => requireSession({ agent: true }), 403],
    // Un token readonly solo llega a los handlers que le pasan su request, y
    // solo si esa request es un GET o un HEAD: decide el método, no el handler.
    ["readonly", "requireSession (sin la request)", requireSession, 403],
    ["readonly", "requireSession({ readonly: GET })", () => requireSession({ readonly: asked("GET") }), null],
    ["readonly", "requireSession({ readonly: HEAD })", () => requireSession({ readonly: asked("HEAD") }), null],
    ["readonly", "requireSession({ readonly: POST })", () => requireSession({ readonly: asked("POST") }), 403],
    ["readonly", "requireSession({ readonly: PUT })", () => requireSession({ readonly: asked("PUT") }), 403],
    ["readonly", "requireSession({ readonly: PATCH })", () => requireSession({ readonly: asked("PATCH") }), 403],
    ["readonly", "requireSession({ readonly: patch })", () => requireSession({ readonly: asked("patch") }), 403],
    ["readonly", "requireSession({ readonly: DELETE })", () => requireSession({ readonly: asked("DELETE") }), 403],
    ["readonly", "requireSession({ readonly: OPTIONS })", () => requireSession({ readonly: asked("OPTIONS") }), 403],
    ["readonly", "requireSession({ agent: true }) (issues)", () => requireSession({ agent: true }), 403],
    ["readonly", "requireSyncSession", requireSyncSession, 403],
    ["readonly", "requireAppSession", requireAppSession, 403],
    ["readonly", "requireUserSession (Settings, tokens)", requireUserSession, 403],
    ["readonly", "requireReleaseToken", requireReleaseToken, 403],
    // Que una lectura admita readonly no la abre a los demás tipos cerrados,
    // ni le cierra un PATCH a los tipos del dueño.
    ["agent", "requireSession({ readonly: GET })", () => requireSession({ readonly: asked("GET") }), 403],
    ["release", "requireSession({ readonly: GET })", () => requireSession({ readonly: asked("GET") }), 403],
    ["automation", "requireSession({ readonly: PATCH })", () => requireSession({ readonly: asked("PATCH") }), null],
    ["mobile", "requireSession({ readonly: GET })", () => requireSession({ readonly: asked("GET") }), null],
  ] as const;

  it.each(cases)("token %s → %s → %s", async (kind, _label, guard, expected) => {
    withToken(kind);
    const res = await guard();
    expect(res === null ? null : res.status).toBe(expected);
  });

  it("un token readonly oye por qué: solo lee", async () => {
    withToken("readonly");
    const res = await requireSession({ readonly: asked("DELETE") });
    expect(await res?.json()).toEqual({ error: READONLY_REFUSAL });
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


describe("mcpBudgetKey", () => {
  it("un token de OAuth cuenta por su conexión, que sobrevive al token de una hora", () => {
    const token = { kind: "token", id: "tok-1", name: "n", label: "l", tokenKind: "agent" } as const;
    expect(mcpBudgetKey({ ...token, oauthGrantId: "g-1" })).toBe("oauth-grant:g-1");
    expect(mcpBudgetKey({ ...token, id: "tok-2", oauthGrantId: "g-1" })).toBe("oauth-grant:g-1");
    expect(mcpBudgetKey(token)).toBe("tok-1");
  });
});

describe("un token de OAuth es solo para el MCP", () => {
  it("las rutas REST lo rechazan, aunque sea un token agent en una ruta de issues", async () => {
    withToken("agent");
    state.record = { ...(state.record as object), oauth_grant_id: "grant-1", audience: "https://book.bolstro.com/api/mcp" };
    expect((await requireSession({ agent: true }))?.status).toBe(403);
    expect((await requireSession())?.status).toBe(403);
  });
});

describe("getWriter", () => {
  it("solo los tipos del dueño escriben como dueño; el resto, con el acceso mínimo", async () => {
    withToken("agent");
    expect(await getWriter()).toEqual({ actor: expect.stringMatching(/^token:agent:claude-agent \(tb_/), access: "agent" });
    withToken("automation");
    expect(await getWriter()).toEqual({ actor: expect.stringMatching(/^token:automation:script \(tb_/), access: "owner" });
    withToken("mobile");
    expect((await getWriter()).access).toBe("owner");
    withToken("readonly");
    expect(await getWriter()).toEqual({ actor: expect.stringMatching(/^token:readonly:fin-cli \(tbro_/), access: "agent" });
    withToken("release");
    expect((await getWriter()).access).toBe("agent");
  });

  it("la sesión del navegador es el dueño; sin quien llame, el acceso mínimo", async () => {
    state.session = { user: { email: "owner@example.com" } };
    expect(await getWriter()).toEqual({ actor: "owner@example.com", access: "owner" });
    state.session = null;
    expect(await getWriter()).toEqual({ actor: null, access: "agent" });
  });
});

// El token readonly del CLI se emitió el 2026-11-14, antes del dominio del
// hash: tiene que seguir leyendo después del deploy, por la cadena real.
describe("un readonly emitido antes del dominio del hash", () => {
  function withPlainReadonly(createdAt: Date) {
    const { token, prefix } = generateToken("readonly");
    state.authorization = `Bearer ${token}`;
    state.record = {
      id: "tok-ro-old", name: "fin-thebook-lectura", kind: "readonly", token_prefix: prefix,
      token_hash: hashToken(token), created_at: createdAt, expires_at: null, revoked_at: null,
    };
  }

  it("sigue leyendo, y sigue sin escribir", async () => {
    withPlainReadonly(new Date("2026-11-14T20:01:26Z"));
    expect(await requireSession({ readonly: asked("GET") })).toBeNull();
    expect((await requireSession({ readonly: asked("POST") }))?.status).toBe(403);
  });

  it("uno así de después del corte no es un token", async () => {
    withPlainReadonly(new Date("2026-11-15T18:00:00Z"));
    expect((await requireSession({ readonly: asked("GET") }))?.status).toBe(401);
  });
});

// Lista blanca: cada tipo conocido tiene su respuesta, y uno que este build no
// conoce no llega a nada. Es lo que pasa al volver a un build anterior a un
// tipo: el valor sigue en la base (Postgres no saca valores de un enum) y el
// código viejo no sabe qué permitirle.
describe("un tipo de token que este build no conoce", () => {
  const unknown = ["superuser", "owner", "Automation", "constructor", "__proto__", ""];

  it.each(unknown)("%j no llega a ninguna ruta, ni pidiéndolo", async (kind) => {
    for (const guard of [
      () => requireSession(),
      () => requireSession({ agent: true }),
      () => requireSession({ readonly: asked("GET") }),
      () => requireSession({ agent: true, readonly: asked("GET") }),
      requireSyncSession,
      requireAppSession,
      requireUserSession,
      requireReleaseToken,
    ]) {
      withToken(kind);
      expect((await guard())?.status).toBe(403);
    }
  });

  it.each(unknown)("%j escribe con el acceso mínimo", async (kind) => {
    withToken(kind);
    expect((await getWriter()).access).toBe("agent");
  });

  it("y oye por qué", async () => {
    withToken("superuser");
    expect(await (await requireSession())?.json()).toEqual({ error: "This kind of token is not accepted here" });
  });
});
