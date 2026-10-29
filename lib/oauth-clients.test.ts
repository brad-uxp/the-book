import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearClientMetadataCache, fetchClientMetadata } from "./oauth-clients";

const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const document = {
  client_id: CLAUDE_CODE,
  client_name: "Claude Code",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  token_endpoint_auth_method: "none",
};

const respond = (body: unknown, init: ResponseInit = {}) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, ...init }));

beforeEach(() => clearClientMetadataCache());

describe("el documento CIMD de un cliente", () => {
  it("se lee de claude.ai, sin seguir redirects", async () => {
    const fetchImpl = respond(document);
    const client = await fetchClientMetadata(CLAUDE_CODE, { fetchImpl: fetchImpl as never });
    expect(client).toEqual({ client_id: CLAUDE_CODE, client_name: "Claude Code", redirect_uris: document.redirect_uris });
    expect(fetchImpl).toHaveBeenCalledWith(CLAUDE_CODE, expect.objectContaining({ redirect: "error" }));
  });

  it("de otro origen no se pide nunca: no hay SSRF que apuntar", async () => {
    const fetchImpl = respond(document);
    expect(await fetchClientMetadata("http://169.254.169.254/latest/meta-data", { fetchImpl: fetchImpl as never })).toBeNull();
    expect(await fetchClientMetadata("https://evil.example/client", { fetchImpl: fetchImpl as never })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("un documento que dice ser otro cliente no vale", async () => {
    const fetchImpl = respond({ ...document, client_id: "https://claude.ai/oauth/someone-else" });
    expect(await fetchClientMetadata(CLAUDE_CODE, { fetchImpl: fetchImpl as never })).toBeNull();
  });

  it("uno enorme, uno que no es JSON o un error tampoco", async () => {
    const big = { ...document, padding: "x".repeat(20_000) };
    expect(await fetchClientMetadata(CLAUDE_CODE, { fetchImpl: respond(big) as never })).toBeNull();
    expect(await fetchClientMetadata(CLAUDE_CODE, { fetchImpl: respond("<html>") as never })).toBeNull();
    expect(await fetchClientMetadata(CLAUDE_CODE, { fetchImpl: respond(document, { status: 403 }) as never })).toBeNull();
  });

  it("queda unos minutos en caché", async () => {
    const fetchImpl = respond(document);
    await fetchClientMetadata(CLAUDE_CODE, { fetchImpl: fetchImpl as never, now: 0 });
    await fetchClientMetadata(CLAUDE_CODE, { fetchImpl: fetchImpl as never, now: 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await fetchClientMetadata(CLAUDE_CODE, { fetchImpl: fetchImpl as never, now: 11 * 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
