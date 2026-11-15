import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { generateToken, type TokenKind } from "@/lib/api-tokens";
import { READONLY_AUDIT_ENTITY_TYPES } from "@/lib/readonly-token";
import { resetRateLimits } from "@/lib/rate-limit";

/**
 * El audit log guarda más que las finanzas: títulos de issues, ideas de canvas
 * borradas, tokens, consentimientos de OAuth. Un token readonly solo recibe
 * las entradas de las finanzas; el resto, el log entero.
 *
 * La cadena de autorización es la real (encabezado → token → tipo); la base
 * es un log en memoria con una entrada por cada `entity_type` que el código
 * audita — sacados del código mismo, de las llamadas a auditLog({…}) y
 * ctx.audit({…}), así un tipo nuevo entra solo y, por ser lista blanca, queda
 * fuera para el readonly hasta que alguien lo sume. Los `entity_type` de las
 * notificaciones (lib/run-daily.ts) no son del log y no cuentan.
 */

const ROOT = join(__dirname, "../../..");

/** The source of every non-test .ts/.tsx file under app/ and lib/. */
function sources(dir = ROOT): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      // Only app/ and lib/ are walked, so the phone's app (mobile/ at the root) never is.
      if (["node_modules", "generated", ".next"].includes(entry)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(readFileSync(full, "utf8"));
    }
  };
  for (const top of ["app", "lib"]) walk(join(dir, top));
  return out;
}

/**
 * The `entity_type` of every object literal passed to auditLog({…}) or
 * ctx.audit({…}): the literal is read up to its matching brace, so a
 * notification's `entity_type` elsewhere in the file is not taken for one.
 */
function auditedEntityTypes(texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const call of text.matchAll(/\b(?:auditLog|audit)\(\s*\{/g)) {
      const open = call.index + call[0].length - 1;
      let depth = 0;
      let end = open;
      for (; end < text.length; end++) {
        if (text[end] === "{") depth++;
        else if (text[end] === "}" && --depth === 0) break;
      }
      const type = /entity_type: "([a-z_]+)"/.exec(text.slice(open, end + 1))?.[1];
      if (type) found.add(type);
    }
  }
  return [...found].sort();
}

const TYPES = auditedEntityTypes(sources());

/**
 * How actor_email looks in the log: tokens (with name and prefix), the owner,
 * the jobs, nobody — and tokens as they were labelled before 2026-10-28,
 * `token:<name>` with no kind, which the log still holds.
 */
const ACTORS = [
  "token:automation:fin-cli (tb_AbCd1234)",
  "token:agent:Claude · 1a2b3c4d (tb_ZzYy9876)",
  "token:readonly:fin-ro (tbro_Abc12345)",
  "token:mobile:mobile · Pixel (tb_Mob11111)",
  "token:cli-books",
  "token:claude:work",
  "owner@example.com",
  "system",
  null,
];

type Entry = {
  id: string;
  entity_type: string;
  entity_name: string;
  action: string;
  actor_email: string | null;
  created_at: Date;
};
type Where = {
  entity_type?: string | { in: string[] };
  action?: string;
  entity_name?: { contains: string };
  AND?: Where[];
};

const state = vi.hoisted(() => ({
  authorization: null as string | null,
  record: null as unknown,
  session: null as unknown,
  log: [] as Entry[],
}));

/** The where clauses the route builds, evaluated over the in-memory log. */
function matches(e: Entry, w: Where): boolean {
  for (const key of Object.keys(w)) {
    if (!["AND", "entity_type", "action", "entity_name"].includes(key)) throw new Error(`where.${key}: unknown to this test`);
  }
  if (w.AND && !w.AND.every((x) => matches(e, x))) return false;
  if (typeof w.entity_type === "string" && e.entity_type !== w.entity_type) return false;
  if (typeof w.entity_type === "object" && !w.entity_type.in.includes(e.entity_type)) return false;
  if (w.action && e.action !== w.action) return false;
  if (w.entity_name && !e.entity_name.toLowerCase().includes(w.entity_name.contains.toLowerCase())) return false;
  return true;
}

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}),
}));
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => state.session),
  isAllowedSession: (s: unknown) => !!s,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: {
      findUnique: vi.fn(async () => state.record),
      update: vi.fn(async () => ({})),
    },
    auditLog: {
      findMany: vi.fn(async ({ where, skip, take }: { where: Where; skip: number; take: number }) =>
        state.log.filter((e) => matches(e, where)).slice(skip, skip + take)
      ),
      count: vi.fn(async ({ where }: { where: Where }) => state.log.filter((e) => matches(e, where)).length),
    },
  },
}));

import { GET } from "./route";

function withToken(kind: TokenKind) {
  const { token, prefix, hash } = generateToken(kind);
  state.authorization = `Bearer ${token}`;
  state.session = null;
  state.record = { id: `tok-${kind}`, name: kind, kind, token_prefix: prefix, token_hash: hash, expires_at: null, revoked_at: null };
}

/** Every page of the log for `query`, as one. */
async function read(
  query = ""
): Promise<{ status: number; types: string[]; total: number; logs: Entry[]; raw: string }> {
  const logs: Entry[] = [];
  let raw = "";
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await GET(new NextRequest(`http://localhost/api/audit-logs?limit=100&page=${page}${query}`));
    if (res.status !== 200) return { status: res.status, types: [], total: 0, logs: [], raw: "" };
    const text = await res.text();
    const body = JSON.parse(text) as { logs: Entry[]; total: number };
    raw += text;
    total = body.total;
    logs.push(...body.logs);
    if (body.logs.length === 0 || logs.length >= total) break;
  }
  return { status: 200, types: [...new Set(logs.map((e) => e.entity_type))].sort(), total, logs, raw };
}

beforeEach(() => {
  resetRateLimits();
  state.authorization = null;
  state.record = null;
  state.session = null;
  // Every type, written by every kind of actor.
  state.log = TYPES.flatMap((t, i) =>
    ACTORS.map((actor_email, j) => ({
      id: `log-${i}-${j}`,
      entity_type: t,
      entity_name: `${t} entry`,
      action: "update",
      actor_email,
      created_at: new Date(Date.UTC(2026, 9, 1 + i, j)),
    }))
  );
});

const BOOKS = [...READONLY_AUDIT_ENTITY_TYPES].sort();

/** Audited types outside the books: what a read-only token must not get. */
const OUTSIDE = ["api_token", "oauth_grant", "oauth_consent", "issue", "canvas_node", "mobile_release", "role"];

describe("los tipos de entrada del log", () => {
  it("el código audita tipos de las finanzas y de afuera", () => {
    expect(TYPES.length).toBeGreaterThan(BOOKS.length);
    for (const t of OUTSIDE) expect(TYPES).toContain(t);
  });

  it("solo cuentan las llamadas a auditLog/ctx.audit, no las notificaciones", () => {
    // run-daily notifica con entity_type "salary_increase_reminder", pero
    // ningún recordatorio se audita: no es un tipo del log.
    expect(sources().some((t) => t.includes('entity_type: "salary_increase_reminder"'))).toBe(true);
    expect(TYPES).not.toContain("salary_increase_reminder");
    expect(auditedEntityTypes(['notify({ entity_type: "x" }); auditLog({ entity_type: "y", after: { a: { b: 1 } } });'])).toEqual(["y"]);
  });

  it("cada tipo de la lista blanca es uno que el código audita (sin erratas)", () => {
    for (const t of BOOKS) expect(TYPES, t).toContain(t);
  });
});

describe("GET /api/audit-logs con un token readonly", () => {
  beforeEach(() => withToken("readonly"));

  it("recibe solo las entradas de las finanzas, y el total cuenta solo esas", async () => {
    const { status, types, total } = await read();
    expect(status).toBe(200);
    expect(types).toEqual(BOOKS);
    expect(total).toBe(BOOKS.length * ACTORS.length);
  });

  it("de un token ve el tipo, no el nombre ni el prefijo", async () => {
    const { logs, raw } = await read();
    const actors = [...new Set(logs.map((e) => e.actor_email))];
    expect(actors.sort()).toEqual(
      ["token:automation", "token:agent", "token:readonly", "token:mobile", "token", "owner@example.com", "system", null].sort()
    );
    for (const leak of ["tb_", "tbro_", "fin-cli", "fin-ro", "Claude", "Pixel", "cli-books", "claude"]) {
      expect(raw).not.toContain(leak);
    }
  });

  it.each(OUTSIDE)(
    "filtrar por %s no lo trae",
    async (type) => {
      expect(await read(`&entity_type=${type}`)).toMatchObject({ status: 200, types: [], total: 0 });
    }
  );

  it("buscar por nombre no abre lo que el tipo cierra", async () => {
    expect(await read("&search=issue")).toMatchObject({ types: [], total: 0 });
  });

  it("filtrar por tipo de las finanzas da todas sus entradas", async () => {
    expect(await read("&entity_type=invoice")).toMatchObject({ types: ["invoice"], total: ACTORS.length });
  });
});

describe("GET /api/audit-logs para todos los demás: sin cambios", () => {
  /** The whole log, actor labels as written. */
  async function expectWholeLog() {
    const { status, types, total, logs } = await read();
    expect({ status, types, total }).toEqual({ status: 200, types: TYPES, total: TYPES.length * ACTORS.length });
    const byId = new Map(state.log.map((e) => [e.id, e.actor_email]));
    for (const e of logs) expect(e.actor_email).toBe(byId.get(e.id));
  }

  it.each(["automation", "mobile"] as const)("un token %s recibe el log entero, con las etiquetas enteras", async (kind) => {
    withToken(kind);
    await expectWholeLog();
  });

  it("la sesión del navegador recibe el log entero, con las etiquetas enteras", async () => {
    state.session = { user: { email: "owner@example.com" } };
    await expectWholeLog();
  });

  it.each(["agent", "release"] as const)("un token %s sigue sin llegar", async (kind) => {
    withToken(kind);
    expect((await read()).status).toBe(403);
  });
});
