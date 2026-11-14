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
 * escribe — sacados del código mismo, así un tipo nuevo entra solo y, por ser
 * lista blanca, queda fuera para el readonly hasta que alguien lo sume.
 */

const ROOT = join(__dirname, "../../..");

/** Every `entity_type: "…"` the app writes to the audit log. */
function writtenEntityTypes(dir = ROOT): string[] {
  const found = new Set<string>();
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (["node_modules", "generated", ".next", "mobile"].includes(entry)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        for (const m of readFileSync(full, "utf8").matchAll(/entity_type: "([a-z_]+)"/g)) found.add(m[1]);
      }
    }
  };
  for (const top of ["app", "lib"]) walk(join(dir, top));
  return [...found].sort();
}

const TYPES = writtenEntityTypes();

type Entry = { id: string; entity_type: string; entity_name: string; action: string; created_at: Date };
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

async function read(query = ""): Promise<{ status: number; types: string[]; total: number }> {
  const res = await GET(new NextRequest(`http://localhost/api/audit-logs?limit=100${query}`));
  const body = res.status === 200 ? await res.json() : { logs: [], total: 0 };
  return {
    status: res.status,
    types: [...new Set((body.logs as Entry[]).map((e) => e.entity_type))].sort(),
    total: body.total,
  };
}

beforeEach(() => {
  resetRateLimits();
  state.authorization = null;
  state.record = null;
  state.session = null;
  state.log = TYPES.map((t, i) => ({
    id: `log-${i}`,
    entity_type: t,
    entity_name: `${t} entry`,
    action: "update",
    created_at: new Date(Date.UTC(2026, 9, 1 + i)),
  }));
});

const BOOKS = [...READONLY_AUDIT_ENTITY_TYPES].sort();

describe("los tipos de entrada del log", () => {
  it("el código escribe tipos de las finanzas y de afuera", () => {
    expect(TYPES.length).toBeGreaterThan(BOOKS.length);
    for (const t of ["api_token", "oauth_grant", "oauth_consent", "issue", "canvas_node", "salary_increase_reminder"]) {
      expect(TYPES).toContain(t);
    }
  });

  it("cada tipo de la lista blanca es uno que el código escribe (sin erratas)", () => {
    for (const t of BOOKS) expect(TYPES, t).toContain(t);
  });
});

describe("GET /api/audit-logs con un token readonly", () => {
  beforeEach(() => withToken("readonly"));

  it("recibe solo las entradas de las finanzas, y el total cuenta solo esas", async () => {
    const { status, types, total } = await read();
    expect(status).toBe(200);
    expect(types).toEqual(BOOKS);
    expect(total).toBe(BOOKS.length);
  });

  it.each(["issue", "canvas_node", "api_token", "oauth_grant", "oauth_consent", "salary_increase_reminder"])(
    "filtrar por %s no lo trae",
    async (type) => {
      expect(await read(`&entity_type=${type}`)).toMatchObject({ status: 200, types: [], total: 0 });
    }
  );

  it("filtrar por un tipo de las finanzas sí", async () => {
    expect(await read("&entity_type=invoice")).toMatchObject({ types: ["invoice"], total: 1 });
  });

  it("buscar por nombre no abre lo que el tipo cierra", async () => {
    expect(await read("&search=issue")).toMatchObject({ types: [], total: 0 });
  });
});

describe("GET /api/audit-logs para todos los demás: sin cambios", () => {
  it.each(["automation", "mobile"] as const)("un token %s recibe el log entero", async (kind) => {
    withToken(kind);
    expect(await read()).toMatchObject({ status: 200, types: TYPES, total: TYPES.length });
  });

  it("la sesión del navegador recibe el log entero", async () => {
    state.session = { user: { email: "owner@example.com" } };
    expect(await read()).toMatchObject({ status: 200, types: TYPES, total: TYPES.length });
  });

  it.each(["agent", "release"] as const)("un token %s sigue sin llegar", async (kind) => {
    withToken(kind);
    expect((await read()).status).toBe(403);
  });
});
