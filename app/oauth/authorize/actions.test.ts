import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Conectar una app por OAuth emite una conexión que se renueva sola, sin
 * fecha de fin: la aprueba solo la cuenta de credenciales (el Gmail personal,
 * lib/allowed-emails.ts), no cualquier sesión de la allowlist. La página ya
 * muestra el rechazo en vez del formulario; la acción lo repite para un POST
 * hecho sin pasar por ella.
 */

const state = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => state.session),
  isAllowedSession: (s: unknown) => !!s,
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn(), getActorEmail: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/oauth-service", () => ({
  checkAuthorizeRequest: vi.fn(async () => ({
    ok: true,
    request: {
      client_name: "Claude",
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      scope: "issues",
      state: "st",
      code_challenge: "c".repeat(43),
    },
  })),
  createCode: vi.fn(async () => "code-1"),
  authorizationResponseUrl: (uri: string, params: Record<string, string>) => `${uri}?${new URLSearchParams(params)}`,
}));

import { decide } from "./actions";
import { CREDENTIAL_REFUSAL } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { checkAuthorizeRequest, createCode } from "@/lib/oauth-service";

const form = (decision: "allow" | "deny") => {
  const data = new FormData();
  data.set("response_type", "code");
  data.set("client_id", "https://claude.ai/oauth/claude-code-client-metadata");
  data.set("decision", decision);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.session = null;
});

describe("decide — quién aprueba una conexión", () => {
  it("la cuenta de Workspace: rechazo antes de validar, auditar o emitir nada", async () => {
    state.session = { user: { email: "brad@uxprogramming.com" } };
    await expect(decide(form("allow"))).rejects.toThrow(CREDENTIAL_REFUSAL);
    expect(checkAuthorizeRequest).not.toHaveBeenCalled();
    expect(createCode).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("el Gmail personal: emite el código y vuelve al cliente", async () => {
    state.session = { user: { email: "bradlyls95@gmail.com" } };
    await expect(decide(form("allow"))).rejects.toThrow(
      "REDIRECT https://claude.ai/api/mcp/auth_callback?code=code-1&state=st"
    );
    expect(createCode).toHaveBeenCalledTimes(1);
  });

  it("sin sesión, al login, como siempre", async () => {
    await expect(decide(form("allow"))).rejects.toThrow("REDIRECT /login");
    expect(createCode).not.toHaveBeenCalled();
  });
});
