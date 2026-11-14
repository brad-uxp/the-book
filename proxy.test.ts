import { describe, it, expect, vi } from "vitest";

// NextAuth's wrapper, reduced to what the proxy reads: no session.
vi.mock("@/auth", () => ({
  auth: (handler: (req: unknown) => unknown) => (req: object) => handler(Object.assign(req, { auth: null })),
  isAllowedSession: (s: unknown) => !!s,
}));

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
