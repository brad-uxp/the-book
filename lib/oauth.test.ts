import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  HOSTED_CALLBACK,
  authorizationServerMetadata,
  canonicalResource,
  grantedScope,
  isAllowedClientId,
  isAllowedRedirect,
  isMcpResource,
  loginReturnPath,
  mcpResource,
  pkceMatches,
  protectedResourceMetadata,
} from "./oauth";

const CLAUDE_CODE_REDIRECTS = ["http://localhost/callback", "http://127.0.0.1/callback"];

describe("recurso (RFC 8707)", () => {
  it("forma canónica: esquema y host en minúscula, sin puerto por defecto ni barra final", () => {
    expect(canonicalResource("HTTPS://Book.Bolstro.com:443/api/mcp/")).toBe("https://book.bolstro.com/api/mcp");
    expect(canonicalResource("https://book.bolstro.com/api/mcp?x=1")).toBeNull();
    expect(canonicalResource("ftp://book.bolstro.com/api/mcp")).toBeNull();
    expect(canonicalResource("no es una url")).toBeNull();
  });

  it("solo el MCP de theBook es el recurso: una audiencia ajena no", () => {
    expect(isMcpResource(mcpResource())).toBe(true);
    expect(isMcpResource(`${mcpResource()}/`)).toBe(true);
    expect(isMcpResource("https://evil.example/api/mcp")).toBe(false);
    expect(isMcpResource(`${new URL(mcpResource()).origin}/api/issues`)).toBe(false);
    expect(isMcpResource(undefined)).toBe(false);
  });
});

describe("clientes: solo los documentos de Claude, en claude.ai", () => {
  it.each([
    ["https://claude.ai/oauth/claude-code-client-metadata", true],
    ["https://claude.ai/oauth/anything", true],
    ["https://claude.ai/", false],
    ["http://claude.ai/oauth/x", false],
    ["https://claude.ai.evil.example/oauth/x", false],
    ["https://evil.example/oauth/claude-code-client-metadata", false],
    ["https://user@claude.ai/oauth/x", false],
    ["https://claude.ai/oauth/x?y=1", false],
    ["claude-code", false],
  ])("%s → %s", (clientId, allowed) => {
    expect(isAllowedClientId(clientId)).toBe(allowed);
  });
});

describe("redirect: solo el callback de Claude o un loopback de Claude Code", () => {
  it("el callback de las apps de Claude, si el documento lo lista", () => {
    expect(isAllowedRedirect(HOSTED_CALLBACK, [HOSTED_CALLBACK])).toBe(true);
    expect(isAllowedRedirect(HOSTED_CALLBACK, CLAUDE_CODE_REDIRECTS)).toBe(false);
  });

  it("loopback en cualquier puerto (RFC 8252 §7.3), localhost incluido", () => {
    expect(isAllowedRedirect("http://localhost:3118/callback", CLAUDE_CODE_REDIRECTS)).toBe(true);
    expect(isAllowedRedirect("http://127.0.0.1:51004/callback", CLAUDE_CODE_REDIRECTS)).toBe(true);
    expect(isAllowedRedirect("http://localhost/callback", CLAUDE_CODE_REDIRECTS)).toBe(true);
  });

  it.each([
    ["otro host", "https://evil.example/callback"],
    ["otro camino en claude.ai", "https://claude.ai/api/mcp/auth_callback/../steal"],
    ["el callback con query", `${HOSTED_CALLBACK}?x=1`],
    ["loopback con otro camino", "http://localhost:3118/steal"],
    ["loopback por https", "https://localhost:3118/callback"],
    ["un host que parece loopback", "http://localhost.evil.example:3118/callback"],
    ["loopback que el documento no lista", "http://[::1]:3118/callback"],
    ["no es una url", "callback"],
  ])("rechaza %s", (_label, redirect) => {
    expect(isAllowedRedirect(redirect, [HOSTED_CALLBACK, ...CLAUDE_CODE_REDIRECTS])).toBe(false);
  });
});

describe("PKCE S256", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  it("el verificador correcto pasa", () => {
    expect(pkceMatches(verifier, challenge)).toBe(true);
  });

  it("un verificador inválido no: otro, corto, o con caracteres de más", () => {
    expect(pkceMatches(verifier.replace("d", "e"), challenge)).toBe(false);
    expect(pkceMatches("short", challenge)).toBe(false);
    expect(pkceMatches(`${verifier}!`, challenge)).toBe(false);
    expect(pkceMatches(verifier, "plain-challenge")).toBe(false);
  });
});

describe("scope", () => {
  it("issues, pedido o no; offline_access no cuesta nada; lo demás se rechaza", () => {
    expect(grantedScope(undefined)).toBe("issues");
    expect(grantedScope("issues offline_access")).toBe("issues");
    expect(grantedScope("issues finances")).toBeNull();
  });
});

describe("la vuelta del login", () => {
  it("solo a la pantalla de consentimiento; si no, al inicio", () => {
    expect(loginReturnPath("/oauth/authorize?client_id=x&state=y")).toBe("/oauth/authorize?client_id=x&state=y");
    expect(loginReturnPath("https://evil.example/")).toBe("/");
    expect(loginReturnPath("//evil.example/oauth/authorize?")).toBe("/");
    expect(loginReturnPath("/oauth/authorizer")).toBe("/");
    expect(loginReturnPath("/oauth/authorize?\\evil")).toBe("/");
    expect(loginReturnPath(undefined)).toBe("/");
  });
});

describe("metadata", () => {
  it("el recurso apunta a theBook como servidor de autorización", () => {
    const prm = protectedResourceMetadata();
    expect(prm.resource).toBe(mcpResource());
    expect(prm.authorization_servers).toEqual([new URL(mcpResource()).origin]);
  });

  it("anuncia CIMD como cliente público, PKCE S256, y nada de registro dinámico", () => {
    const as = authorizationServerMetadata();
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as).not.toHaveProperty("registration_endpoint");
  });
});
