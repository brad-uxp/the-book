import { describe, it, expect, vi, beforeEach } from "vitest";

// NextAuth's wrapper, reduced to what the proxy reads: the session, none
// unless a test signs in.
const state = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/auth", () => ({
  auth: (handler: (req: unknown) => unknown) => (req: object) => handler(Object.assign(req, { auth: state.session })),
  isAllowedSession: (s: unknown) => !!s,
}));

beforeEach(() => {
  state.session = null;
});

import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { READONLY_REFUSAL } from "@/lib/readonly-token";

const RO = `tbro_${"A".repeat(43)}`;
const TB = `tb_${"A".repeat(43)}`;

type ProxyFn = (req: NextRequest) => Promise<Response>;

function hit(path: string, method: string, authorization?: string): Promise<Response> {
  const headers = authorization ? { authorization } : undefined;
  return (proxy as unknown as ProxyFn)(new NextRequest(`http://localhost${path}`, { method, headers }));
}

/** NextResponse.next(): the request goes on to the handler. */
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy: un token readonly solo lee", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("%s con tbro_ → 403 antes del handler", async (method) => {
    const res = await hit("/api/invoices/abc", method, `Bearer ${RO}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: READONLY_REFUSAL });
  });

  it.each(["/api/oauth/token", "/api/auth/signin", "/api/cron/daily", "/api/mobile/sign-in", "/login", "/invoices"])(
    "también en %s, que el proxy deja pasar sin sesión",
    async (path) => {
      expect((await hit(path, "POST", `Bearer ${RO}`)).status).toBe(403);
    }
  );

  // El MCP contesta 401 con WWW-Authenticate a todo token que no sea de su
  // OAuth; a un tbro_ ya no le llega: el proxy le da 403, sin desafío.
  it("POST /api/mcp con tbro_ → 403 del proxy, no el 401 con WWW-Authenticate", async () => {
    const res = await hit("/api/mcp", "POST", `Bearer ${RO}`);
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(await res.json()).toEqual({ error: READONLY_REFUSAL });
  });

  it("sin importar mayúsculas ni espacios en el encabezado", async () => {
    for (const header of [`bearer ${RO}`, `BEARER   ${RO.toUpperCase()}`, `  Bearer ${RO}`]) {
      expect((await hit("/api/clients", "POST", header)).status).toBe(403);
    }
  });

  it.each(["GET", "HEAD"])("%s con tbro_ sigue al handler, que valida el token", async (method) => {
    expect(passed(await hit("/api/invoices", method, `Bearer ${RO}`))).toBe(true);
  });

  it("un token tb_ escribe como siempre: lo decide su handler", async () => {
    expect(passed(await hit("/api/invoices", "POST", `Bearer ${TB}`))).toBe(true);
  });

  it("sin credencial, la API sigue en 401", async () => {
    expect((await hit("/api/invoices", "POST")).status).toBe(401);
  });
});

// SameSite=Lax deja la cookie fuera de otro sitio, pero no de otro origen del
// mismo sitio: una página en otro host bajo bolstro.com podía hacerle al
// navegador del dueño un POST con la cookie. Una sesión escribe solo desde las
// páginas de book.
describe("proxy: una sesión escribe solo desde las páginas de book", () => {
  const OWNER = { user: { email: "bradlyls95@gmail.com" } };
  const send = (path: string, method: string, headers: Record<string, string>) =>
    (proxy as unknown as ProxyFn)(new NextRequest(`http://localhost${path}`, { method, headers }));
  const refused = async (res: Response) => res.status === 403 && /own pages/.test((await res.json()).error);

  beforeEach(() => {
    state.session = OWNER;
  });

  it.each(["same-site", "cross-site"])("POST con Sec-Fetch-Site %s → 403 antes del handler", async (site) => {
    expect(await refused(await send("/api/other-expenses", "POST", { "sec-fetch-site": site }))).toBe(true);
  });

  it.each(["PUT", "PATCH", "DELETE"])("también %s", async (method) => {
    expect(await refused(await send("/api/invoices/abc", method, { "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("en cualquier ruta: una server action de una página y /api/auth también", async () => {
    for (const path of ["/invoices", "/oauth/authorize", "/api/auth/signout", "/api/sync/notes"]) {
      expect(await refused(await send(path, "POST", { "sec-fetch-site": "same-site" }))).toBe(true);
    }
  });

  it("desde la propia página (same-origin) sigue al handler", async () => {
    expect(passed(await send("/api/other-expenses", "POST", { "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("sin Fetch Metadata decide el Origin: otro host → 403; el propio → sigue", async () => {
    expect(await refused(await send("/api/other-expenses", "POST", { origin: "https://other.bolstro.com" }))).toBe(true);
    expect(await refused(await send("/api/other-expenses", "POST", { origin: "null" }))).toBe(true);
    expect(passed(await send("/api/other-expenses", "POST", { origin: "https://book.bolstro.com" }))).toBe(true);
    expect(passed(await send("/api/other-expenses", "POST", { origin: "http://localhost" }))).toBe(true);
  });

  it("sin ninguno de los dos no vino de una página: sigue (un script, el teléfono)", async () => {
    expect(passed(await send("/api/other-expenses", "POST", {}))).toBe(true);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("%s desde otro origen sigue: no cambia nada", async (method) => {
    expect(passed(await send("/api/invoices", method, { "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("sin sesión no aplica: los endpoints públicos los llama un servidor, no una página", async () => {
    state.session = null;
    expect(passed(await send("/api/oauth/token", "POST", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(passed(await send("/api/mobile/sign-in", "POST", { origin: "https://elsewhere.example" }))).toBe(true);
  });
});
