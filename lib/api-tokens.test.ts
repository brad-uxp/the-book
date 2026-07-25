import { describe, it, expect } from "vitest";
import {
  generateToken,
  hashToken,
  bearerFromHeader,
  checkToken,
  tokenActor,
  type TokenRecord,
} from "./api-tokens";

describe("generateToken", () => {
  it("produce un token con el prefijo reconocible", () => {
    const { token, prefix } = generateToken();
    expect(token.startsWith("tb_")).toBe(true);
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix).toHaveLength(11);
  });

  it("tiene al menos 256 bits de entropía", () => {
    const { token } = generateToken();
    const secret = token.slice(3);
    // 32 bytes en base64url son 43 caracteres sin padding.
    expect(secret).toHaveLength(43);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("nunca repite un token", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateToken().token);
    expect(seen.size).toBe(500);
  });

  it("el hash guardado corresponde al token, y el token no se puede derivar de él", () => {
    const { token, hash } = generateToken();
    expect(hash).toBe(hashToken(token));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token.slice(3));
  });

  it("dos tokens distintos no colisionan en el prefijo", () => {
    const prefixes = new Set<string>();
    for (let i = 0; i < 500; i++) prefixes.add(generateToken().prefix);
    // 8 caracteres base64url de aleatoriedad tras "tb_": colisión improbable.
    expect(prefixes.size).toBe(500);
  });
});

describe("bearerFromHeader", () => {
  it("extrae un token bien formado", () => {
    const { token } = generateToken();
    expect(bearerFromHeader(`Bearer ${token}`)).toBe(token);
  });

  it("acepta el esquema sin distinguir mayúsculas y con espacios extra", () => {
    const { token } = generateToken();
    expect(bearerFromHeader(`bearer   ${token}`)).toBe(token);
    expect(bearerFromHeader(`  Bearer ${token}  `)).toBe(token);
  });

  it.each([
    [null, "ausente"],
    [undefined, "undefined"],
    ["", "vacío"],
    ["Bearer", "sin credencial"],
    ["Bearer ", "credencial vacía"],
    ["Basic tb_abc", "otro esquema"],
    ["tb_sinbearer", "sin esquema"],
    ["Bearer sk_de_otro_sistema", "prefijo ajeno"],
    ["Bearer tb_uno tb_dos", "dos valores"],
  ])(
    "devuelve null para %j (%s)",
    (header: string | null | undefined, _motivo: string) => {
      expect(bearerFromHeader(header)).toBeNull();
    }
  );
});

describe("checkToken — reglas de validez", () => {
  const now = new Date("2026-07-25T12:00:00Z");

  function recordFor(token: string, overrides: Partial<TokenRecord> = {}): TokenRecord {
    return {
      id: "tok-1",
      name: "claude-work",
      token_hash: hashToken(token),
      expires_at: null,
      revoked_at: null,
      ...overrides,
    };
  }

  it("acepta un token vigente", () => {
    const { token } = generateToken();
    expect(checkToken(recordFor(token), token, now)).toEqual({
      id: "tok-1",
      name: "claude-work",
    });
  });

  it("rechaza cuando no existe el registro", () => {
    const { token } = generateToken();
    expect(checkToken(null, token, now)).toBeNull();
  });

  it("rechaza un token revocado, aunque el hash coincida", () => {
    const { token } = generateToken();
    const rec = recordFor(token, { revoked_at: new Date("2026-07-01T00:00:00Z") });
    expect(checkToken(rec, token, now)).toBeNull();
  });

  it("rechaza un token expirado", () => {
    const { token } = generateToken();
    const rec = recordFor(token, { expires_at: new Date("2026-07-24T23:59:59Z") });
    expect(checkToken(rec, token, now)).toBeNull();
  });

  it("acepta justo antes de expirar y rechaza justo al expirar", () => {
    const { token } = generateToken();
    const expires = new Date("2026-07-25T12:00:00Z");
    expect(checkToken(recordFor(token, { expires_at: expires }), token, now)).toBeNull();
    const later = new Date("2026-07-25T12:00:01Z");
    expect(
      checkToken(recordFor(token, { expires_at: later }), token, now)
    ).not.toBeNull();
  });

  it("rechaza un token distinto que comparte prefijo", () => {
    const a = generateToken();
    const b = generateToken();
    // El lookup es por prefijo; si dos coincidieran, el hash debe salvar igual.
    expect(checkToken(recordFor(a.token), b.token, now)).toBeNull();
  });

  it("rechaza un hash corrupto o vacío sin lanzar", () => {
    const { token } = generateToken();
    expect(checkToken(recordFor(token, { token_hash: "" }), token, now)).toBeNull();
    expect(checkToken(recordFor(token, { token_hash: "zz" }), token, now)).toBeNull();
  });

  it("sin expiración el token no caduca", () => {
    const { token } = generateToken();
    const muyDespues = new Date("2099-01-01T00:00:00Z");
    expect(
      checkToken(recordFor(token, { expires_at: null }), token, muyDespues)
    ).not.toBeNull();
  });
});

describe("tokenActor", () => {
  it("marca al agente como distinto de un humano en la auditoría", () => {
    expect(tokenActor("claude-work")).toBe("token:claude-work");
    // Lo que importa: no se puede confundir con un email.
    expect(tokenActor("claude-work")).not.toContain("@");
  });
});
