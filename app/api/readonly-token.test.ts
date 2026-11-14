import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { generateToken, READONLY_REFUSAL, type TokenKind } from "@/lib/api-tokens";
import { resetRateLimits } from "@/lib/rate-limit";

/**
 * Un token `readonly` lee las finanzas y no escribe nada, en toda la API.
 *
 * No simula requireSession: la cadena es la real — encabezado → tabla de
 * tokens → tipo del token → la ruta — sobre cada `route.ts` de app/api. La
 * base es un registrador: anota cada operación con sus argumentos y contesta
 * con una fila de mentira (findUnique, findFirst, findMany), así que un
 * handler que deja pasar al token llega a su lógica — y a sus escrituras — en
 * vez de cortar en un 404.
 *
 * Una ruta nueva entra sola: su GET queda cerrado al token salvo que se sume a
 * READS (y pase `{ readonly: req }`), y su POST/PATCH/DELETE tiene que
 * rechazarlo.
 */

const state = vi.hoisted(() => ({
  authorization: null as string | null,
  record: null as unknown,
  calls: [] as { op: string; args: unknown }[],
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
  // Una fila que sirve de factura, cliente, suscripción, persona o gasto:
  // los campos que los handlers leen, con valores de verdad.
  const day = new Date("2026-10-01T00:00:00Z");
  const row = () => ({
    id: "00000000-0000-4000-8000-000000000000",
    name: "Stub",
    title: "Stub",
    description: null,
    color_hex: "#123456",
    amount: 100_000,
    amount_cents: 100_000,
    currency: "USD",
    status: "sent",
    invoice_number: "A-1",
    category: "software",
    frequency: "monthly",
    pay_day: 1,
    period: "2026-10",
    due_date: day,
    paid_date: day,
    issue_date: day,
    start_date: day,
    end_date: null,
    effective_date: day,
    created_at: day,
    updated_at: day,
    deleted_at: null,
    is_active: true,
    file_key: null,
    file_url: "https://files.example/invoice.pdf",
    client_id: "c-1",
    referrer_id: null,
    role_id: null,
    fee_cents: 5_000,
    total_cents: 100_000,
    paid_at: day,
    date: day,
    client: { id: "c-1", name: "Client", color_hex: "#123456" },
    person: { id: "p-1", name: "Person" },
    subscription: { id: "s-1", name: "Subscription" },
    referrer: null,
    role: null,
    salary_base: null,
    payments: [],
    salary_payments: [],
    increase_reminders: [],
    clients: [],
    invoices: [],
    fee_payments: [],
    corporate_excluded_client_ids: [],
    _count: { invoices: 0, fee_payments: 0, default_clients: 0 },
  });
  const READS: Record<string, () => unknown> = {
    findMany: () => [row()],
    findFirst: row,
    findUnique: row,
    count: () => 1,
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
            state.calls.push({ op: `${name}.${op}`, args });
            if (name === "apiToken" && op === "findUnique") return state.record;
            return op in READS ? READS[op]() : row();
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
            state.calls.push({ op: "$transaction", args: null });
            return typeof arg === "function" ? arg(prisma) : Promise.all(arg as Promise<unknown>[]);
          };
        }
        if (key.startsWith("$")) {
          return async (args: unknown) => {
            state.calls.push({ op: key, args });
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
 * Lo único que un token readonly lee — lo que necesita el CLI de finanzas — y
 * la tabla que cada lectura tiene que consultar: que la consulte prueba que el
 * token pasó la guarda y llegó a los datos. Todo otro GET le da 403.
 */
const READS: Record<string, string> = {
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
  "roles/route.ts": "role.findMany",
  "referrers/route.ts": "referrer.findMany",
  "referrers/summary/route.ts": "referrer.findMany",
  "referrers/[id]/detail/route.ts": "invoice.findMany",
  "referrers/[id]/clients/route.ts": "client.findMany",
  "fee-payments/route.ts": "feePayment.findMany",
  "metrics/route.ts": "invoice.findMany",
  "settings/route.ts": "settings.findUnique",
  "audit-logs/route.ts": "auditLog.findMany",
};

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

/** Rutas que no llaman a requireSession y rechazan con su propia respuesta. */
const OWN_REFUSAL: Record<string, number> = {
  // El handler responde el desafío WWW-Authenticate que arranca el OAuth del
  // cliente. En producción un POST con un tbro_ no llega: proxy.ts le da 403
  // antes (proxy.test.ts).
  "mcp/route.ts": 401,
  "mobile/releases/route.ts": 403,
  "mobile/releases/[code]/publish/route.ts": 403,
  "settings/connections/route.ts": 403,
  "settings/connections/[id]/route.ts": 403,
  "settings/tokens/route.ts": 403,
  "settings/tokens/[id]/route.ts": 403,
};

const TOKEN_GUARD = /\brequire(Session|UserSession|AppSession|SyncSession|ReleaseToken|AgentToken|MobileToken)\(/;

/**
 * What a write looks like to the recorder. Raw SQL counts, both kinds: a
 * `$queryRaw` can write as well as an `$executeRaw` (an INSERT … RETURNING),
 * and no handler a read-only token reaches needs either.
 */
const WRITE_OPS =
  /\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)$|^\$(executeRaw|queryRaw)/;

/**
 * The one write a request may make: resolveActor stamping the presented
 * token's last_used_at — that token, that column, nothing else.
 */
function isLastUsedStamp(c: { op: string; args: unknown }): boolean {
  if (c.op !== "apiToken.update") return false;
  const { where, data, ...rest } = (c.args ?? {}) as { where?: unknown; data?: Record<string, unknown> };
  const token = state.record as { id: string } | null;
  return (
    Object.keys(rest).length === 0 &&
    JSON.stringify(where) === JSON.stringify({ id: token?.id }) &&
    data !== undefined &&
    Object.keys(data).length === 1 &&
    data.last_used_at instanceof Date
  );
}

function writes(): string[] {
  return state.calls.filter((c) => WRITE_OPS.test(c.op) && !isLastUsedStamp(c)).map((c) => c.op);
}

const ops = () => state.calls.map((c) => c.op);

function withToken(kind: TokenKind) {
  const { token, prefix, hash } = generateToken(kind);
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

/** "invoices/[id]/route.ts" → "invoices/[id]", for the URL and the test names. */
const pathOf = (file: string) => file.replace(/\/?route\.ts$/, "");

async function call(
  file: string,
  method: string,
  handler: Handler,
  body: unknown = {}
): Promise<{ status: number; body: unknown }> {
  const init =
    method === "GET" || method === "HEAD"
      ? { method }
      : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } };
  const res = await handler(new NextRequest(`http://localhost/api/${pathOf(file)}`, init), {
    params: Promise.resolve(PARAMS),
  });
  return { status: res.status, body: await res.clone().json().catch(() => null) };
}

const files = routeFiles().sort();
const tokenRoutes = files.filter((f) => !(f in NOT_TOKEN_ROUTES));

async function load(file: string): Promise<RouteModule> {
  return (await import(join(API_DIR, file))) as RouteModule;
}

beforeEach(() => {
  resetRateLimits();
  state.calls.length = 0;
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

  it("cada lectura de la lista existe como GET", async () => {
    for (const file of Object.keys(READS)) {
      expect((await load(file)).GET, file).toBeTypeOf("function");
    }
  });

  it("el token es un tbro_ de verdad: la cadena lo valida y lo reconoce como readonly", async () => {
    expect(state.authorization).toMatch(/^Bearer tbro_/);
    const { GET } = await load("clients/route.ts");
    expect((await call("clients/route.ts", "GET", GET!)).status).toBe(200);
    expect(isLastUsedStamp(state.calls.find((c) => c.op === "apiToken.update")!)).toBe(true);
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

  // Lo que pasaría si un PATCH copiara la línea del GET, `{ readonly: req }`:
  // cada handler de lectura, llamado con un método de escritura, lo rechaza,
  // porque decide el método de la request y no la marca del handler.
  const copiedCases = Object.keys(READS).flatMap((file) =>
    WRITE_METHODS.map((method) => [pathOf(file), method, file] as const)
  );

  it.each(copiedCases)("el GET de /api/%s llamado con %s → 403", async (_path, method, file) => {
    const { GET } = await load(file);
    const { status, body } = await call(file, method, GET!);
    expect(status).toBe(403);
    expect(body).toEqual({ error: READONLY_REFUSAL });
    expect(ops().filter((op) => !op.startsWith("apiToken."))).toEqual([]);
  });
});

describe("un token readonly lee las finanzas, y nada más", () => {
  // Next.js responde HEAD con el GET de la ruta cuando no exporta uno propio.
  const readCases = tokenRoutes.flatMap((file) =>
    (["GET", "HEAD"] as const).map((method) => [method, pathOf(file), file] as const)
  );

  it.each(readCases)("%s /api/%s", async (method, _path, file) => {
    const mod = await load(file);
    const handler = method === "HEAD" ? (mod.HEAD ?? mod.GET) : mod.GET;
    if (!handler) return;
    const { status, body } = await call(file, method, handler);
    if (file in READS) {
      expect(status).toBe(200);
      expect(ops()).toContain(READS[file]);
    } else {
      expect(status).toBe(OWN_REFUSAL[file] ?? 403);
      if (!(file in OWN_REFUSAL)) expect(body).toEqual({ error: READONLY_REFUSAL });
      expect(ops().filter((op) => !op.startsWith("apiToken."))).toEqual([]);
    }
    expect(writes()).toEqual([]);
  });
});

// Control: el mismo arnés, con un token de automatización, sí llega a
// escribir. Así los 403 de arriba son del token readonly, y una escritura que
// se colara la vería writes().
describe("control: un token de automatización sí escribe", () => {
  beforeEach(() => withToken("automation"));

  it("PATCH /api/clients/:id actualiza", async () => {
    const { PATCH } = await load("clients/[id]/route.ts");
    const { status } = await call("clients/[id]/route.ts", "PATCH", PATCH!, { name: "Renamed" });
    expect(status).toBe(200);
    expect(writes()).toContain("client.update");
  });

  it("DELETE /api/other-expenses/:id borra", async () => {
    const { DELETE } = await load("other-expenses/[id]/route.ts");
    await call("other-expenses/[id]/route.ts", "DELETE", DELETE!);
    expect(writes().some((op) => op.startsWith("otherExpense."))).toBe(true);
  });

  it("el SQL crudo cuenta como escritura, de los dos tipos", () => {
    for (const op of ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]) {
      state.calls.push({ op, args: null });
    }
    expect(writes()).toEqual(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);
  });

  it("un update del token que no sea solo su last_used_at cuenta como escritura", () => {
    state.calls.push({ op: "apiToken.update", args: { where: { id: "tok-automation" }, data: { revoked_at: new Date() } } });
    state.calls.push({ op: "apiToken.update", args: { where: { id: "otro" }, data: { last_used_at: new Date() } } });
    state.calls.push({
      op: "apiToken.update",
      args: { where: { id: "tok-automation" }, data: { last_used_at: new Date(), name: "x" } },
    });
    expect(writes()).toEqual(["apiToken.update", "apiToken.update", "apiToken.update"]);
  });
});
