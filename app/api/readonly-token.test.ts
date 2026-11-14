import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { generateToken, READONLY_REFUSAL, type TokenKind } from "@/lib/api-tokens";
import { resetRateLimits } from "@/lib/rate-limit";

/**
 * Un token `readonly` lee y no escribe, en toda la API.
 *
 * No simula requireSession: la cadena es la real — encabezado → tabla de
 * tokens → tipo del token → la ruta — sobre cada `route.ts` de app/api. La
 * base es un registrador: anota cada operación y devuelve vacío, así que un
 * test que vea una escritura sabe que la ruta dejó pasar al token.
 *
 * Así una ruta nueva entra sola: si su POST/PATCH/DELETE no rechaza al token,
 * o su GET no lo deja leer, este archivo falla sin que nadie se acuerde de
 * agregarla.
 */

const state = vi.hoisted(() => ({
  authorization: null as string | null,
  record: null as unknown,
  calls: [] as string[],
  args: [] as { op: string; args: unknown }[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  isAllowedSession: () => false,
}));

vi.mock("@/lib/db", () => {
  const READS: Record<string, () => unknown> = {
    findMany: () => [],
    findFirst: () => null,
    findUnique: () => null,
    count: () => 0,
    groupBy: () => [],
    aggregate: () => ({ _sum: {}, _count: {}, _avg: {}, _min: {}, _max: {} }),
  };
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, op) => {
          if (typeof op !== "string" || op === "then") return undefined;
          return async (args: unknown) => {
            state.calls.push(`${name}.${op}`);
            state.args.push({ op: `${name}.${op}`, args });
            if (name === "apiToken" && op === "findUnique") return state.record;
            return op in READS ? READS[op]() : {};
          };
        },
      }
    );
  const prisma: unknown = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== "string" || key === "then") return undefined;
        if (key === "$transaction") {
          return async (arg: unknown) => {
            state.calls.push("$transaction");
            return typeof arg === "function" ? arg(prisma) : Promise.all(arg as Promise<unknown>[]);
          };
        }
        if (key.startsWith("$")) {
          return async () => {
            state.calls.push(key);
            return [];
          };
        }
        return model(key);
      },
    }
  );
  return { prisma };
});

const API_DIR = __dirname;
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteModule = Partial<Record<"GET" | "HEAD" | (typeof WRITE_METHODS)[number], Handler>>;

/** Every route.ts under app/api, relative to it ("invoices/[id]/route.ts"). */
function routeFiles(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [relative(API_DIR, full)] : [];
  });
}

/**
 * Rutas que no miran un Bearer: su credencial es otra, y ningún token llega a
 * escribir por ellas. Se saltean, y el test de abajo comprueba que sigan sin
 * llamar a ninguna guarda de token.
 */
const NOT_TOKEN_ROUTES: Record<string, string> = {
  "auth/[...nextauth]/route.ts": "NextAuth: el login de Google del navegador",
  "cron/daily/route.ts": "CRON_SECRET",
  "mobile/nonce/route.ts": "pública: el teléfono todavía no tiene credencial",
  "mobile/sign-in/route.ts": "ID token de Google + nonce de un solo uso",
  "oauth/token/route.ts": "credenciales del cliente OAuth del MCP",
};

/** Rutas que ya rechazan a todo token que no sea el suyo, con su propio mensaje. */
const OWN_REFUSAL: Record<string, number> = {
  "mcp/route.ts": 401, // el desafío WWW-Authenticate que arranca el OAuth del cliente
  "mobile/releases/route.ts": 403,
  "mobile/releases/[code]/publish/route.ts": 403,
  "mobile/releases/latest/route.ts": 403,
  "settings/connections/route.ts": 403,
  "settings/connections/[id]/route.ts": 403,
  "settings/tokens/route.ts": 403,
  "settings/tokens/[id]/route.ts": 403,
  "sync/notes/route.ts": 403,
  "sync/refs/route.ts": 403,
};

const TOKEN_GUARD = /\brequire(Session|UserSession|AppSession|SyncSession|ReleaseToken|AgentToken|MobileToken)\(/;

/** What a write looks like to the recorder. */
const WRITE_OPS = /\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)$|^\$executeRaw/;

/** Writes other than the token's own last_used_at, which resolveActor records on every request. */
function writes(): string[] {
  return state.calls.filter((c) => WRITE_OPS.test(c) && c !== "apiToken.update");
}

function withToken(kind: TokenKind) {
  const { token, prefix, hash } = generateToken();
  state.authorization = `Bearer ${token}`;
  state.record = {
    id: `tok-${kind}`,
    name: `${kind}-script`,
    kind,
    token_prefix: prefix,
    token_hash: hash,
    expires_at: null,
    revoked_at: null,
  };
}

const PARAMS = { id: "00000000-0000-4000-8000-000000000000", nodeId: "n-1", edgeId: "e-1", code: "1" };

async function call(file: string, method: string, handler: Handler): Promise<{ status: number; body: unknown }> {
  const url = `http://localhost/api/${pathOf(file)}`;
  const init = method === "GET" || method === "HEAD"
    ? { method }
    : { method, body: "{}", headers: { "content-type": "application/json" } };
  const res = await handler(new NextRequest(url, init), { params: Promise.resolve(PARAMS) });
  const body = await res.clone().json().catch(() => null);
  return { status: res.status, body };
}

const files = routeFiles().sort();
/** "invoices/[id]/route.ts" → "invoices/[id]", for the test names. */
const pathOf = (file: string) => file.replace(/\/?route\.ts$/, "");
const tokenRoutes = files.filter((f) => !(f in NOT_TOKEN_ROUTES));

async function load(file: string): Promise<RouteModule> {
  return (await import(join(API_DIR, file))) as RouteModule;
}

beforeEach(() => {
  resetRateLimits();
  state.calls.length = 0;
  state.args.length = 0;
  withToken("readonly");
});

describe("el mapa de rutas que este test recorre", () => {
  it("encuentra las rutas de la API", () => {
    expect(tokenRoutes.length).toBeGreaterThan(40);
  });

  it.each(Object.keys(NOT_TOKEN_ROUTES))("%s sigue sin mirar un token (si no, sacala de la lista)", (file) => {
    expect(files).toContain(file);
    expect(readFileSync(join(API_DIR, file), "utf8")).not.toMatch(TOKEN_GUARD);
  });
});

describe("un token readonly no crea, no modifica y no borra nada", () => {
  const writeCases = tokenRoutes.flatMap((file) => WRITE_METHODS.map((method) => [method, pathOf(file), file] as const));

  it.each(writeCases)("%s /api/%s → rechazado, sin tocar la base", async (method, _path, file) => {
    const handler = (await load(file))[method];
    if (!handler) return; // la ruta no tiene ese método: Next.js responde 405 solo
    const { status, body } = await call(file, method, handler);
    expect(status).toBe(OWN_REFUSAL[file] ?? 403);
    if (!(file in OWN_REFUSAL)) expect(body).toEqual({ error: READONLY_REFUSAL });
    expect(writes()).toEqual([]);
  });
});

/**
 * Lo que el CLI de finanzas tiene que poder leer, y la tabla que cada lectura
 * consulta: que la consulte prueba que el token pasó la guarda y llegó a los
 * datos (un 404 de un id que no existe también es leer).
 */
const MUST_READ: Record<string, string> = {
  "invoices/route.ts": "invoice.findMany",
  "invoices/[id]/route.ts": "invoice.findUnique",
  "invoices/[id]/download-url/route.ts": "invoice.findUnique",
  "clients/route.ts": "client.findMany",
  "subscriptions/route.ts": "subscription.findMany",
  "subscriptions/[id]/route.ts": "subscription.findUnique",
  "subscriptions/[id]/payments/route.ts": "subscriptionPayment.findMany",
  "other-expenses/route.ts": "otherExpense.findMany",
  "people/route.ts": "person.findMany",
  "people/[id]/route.ts": "person.findUnique",
  "people/[id]/payments/route.ts": "salaryPayment.findMany",
  "referrers/route.ts": "referrer.findMany",
  "referrers/summary/route.ts": "referrer.findMany",
  "referrers/[id]/detail/route.ts": "invoice.findMany",
  "referrers/[id]/clients/route.ts": "client.findMany",
  "metrics/route.ts": "invoice.findMany",
  "roles/route.ts": "role.findMany",
  "fee-payments/route.ts": "feePayment.findMany",
  "settings/route.ts": "settings.findUnique",
  "issues/route.ts": "issue.findMany",
};

describe("un token readonly lee", () => {
  // Next.js responde HEAD con el GET de la ruta cuando no exporta uno propio.
  const readCases = tokenRoutes.flatMap((file) => (["GET", "HEAD"] as const).map((method) => [method, pathOf(file), file] as const));

  it.each(readCases)("%s /api/%s", async (method, _path, file) => {
    const mod = await load(file);
    const handler = method === "HEAD" ? (mod.HEAD ?? mod.GET) : mod.GET;
    if (!handler) return;
    const { status } = await call(file, method, handler);
    if (file in OWN_REFUSAL) {
      expect(status).toBe(OWN_REFUSAL[file]);
    } else {
      expect([401, 403]).not.toContain(status);
      expect(status).toBeLessThan(500);
    }
    if (MUST_READ[file]) expect(state.calls).toContain(MUST_READ[file]);
    expect(writes()).toEqual([]);
  });

  it("cada lectura que el CLI necesita existe como GET", async () => {
    for (const file of Object.keys(MUST_READ)) {
      expect((await load(file)).GET, file).toBeTypeOf("function");
    }
  });

  it("ve las notas de issues, no solo las tareas como un agente", async () => {
    const { GET } = await load("issues/route.ts");
    await call("issues/route.ts", "GET", GET!);
    const where = (state.args.find((a) => a.op === "issue.findMany")?.args as { where?: { category?: unknown } })?.where;
    expect(where?.category).toBeUndefined();

    state.args.length = 0;
    withToken("agent");
    await call("issues/route.ts", "GET", GET!);
    const agentWhere = (state.args.find((a) => a.op === "issue.findMany")?.args as { where?: { category?: unknown } })?.where;
    expect(agentWhere?.category).toBe("task");
  });
});

// Control: el mismo arnés deja escribir a un token de automatización, así que
// los 403 de arriba son del token readonly y no del arnés.
describe("control: un token de automatización sí escribe", () => {
  it("POST /api/clients crea", async () => {
    withToken("automation");
    const { POST } = await load("clients/route.ts");
    const req = new NextRequest("http://localhost/api/clients", {
      method: "POST",
      body: JSON.stringify({ name: "Acme", color_hex: "#123456" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST!(req, { params: Promise.resolve(PARAMS) });
    expect(res.status).toBe(201);
    expect(writes()).toContain("client.create");
  });

  it("DELETE /api/other-expenses/:id llega a la base", async () => {
    withToken("automation");
    const { DELETE } = await load("other-expenses/[id]/route.ts");
    await call("other-expenses/[id]/route.ts", "DELETE", DELETE!);
    expect(state.calls.some((c) => c.startsWith("otherExpense."))).toBe(true);
  });
});
