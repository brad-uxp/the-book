import { describe, it, expect } from "vitest";
import {
  generateToken,
  hashToken,
  bearerFromHeader,
  checkToken,
  prefixOf,
  tokenActor,
  tokenActorKindOnly,
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
      kind: "automation",
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
      kind: "automation",
      audience: null,
      oauthGrantId: null,
    });
  });

  it("dice para qué es el token: la sync del teléfono decide con eso", () => {
    const { token } = generateToken();
    expect(checkToken(recordFor(token, { kind: "mobile" }), token, now)?.kind).toBe("mobile");
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
    const actor = tokenActor({ name: "claude-work", kind: "agent", prefix: "tb_AbCd1234" });
    // El tipo dice qué podía hacer; el prefijo distingue dos tokens con el mismo nombre.
    expect(actor).toBe("token:agent:claude-work (tb_AbCd1234)");
    // Lo que importa: no se puede confundir con un email.
    expect(actor).not.toContain("@");
  });
});

// Un token readonly lleva su propia cabeza, `tbro_`: el proxy lo reconoce
// antes de leer la base y le corta todo lo que no sea una lectura.
describe("la cabeza de un token readonly", () => {
  it("generateToken(\"readonly\") da un tbro_ con prefijo de 13", () => {
    const { token, prefix, hash } = generateToken("readonly");
    expect(token.startsWith("tbro_")).toBe(true);
    expect(token.slice(5)).toHaveLength(43);
    expect(prefix).toHaveLength(13);
    expect(token.startsWith(prefix)).toBe(true);
    expect(hash).toBe(hashToken(token));
  });

  it("los demás tipos siguen con tb_", () => {
    for (const kind of ["automation", "mobile", "release", "agent"] as const) {
      const { token, prefix } = generateToken(kind);
      expect(token.startsWith("tb_")).toBe(true);
      expect(prefix).toHaveLength(11);
    }
  });

  it("un tb_ nunca empieza con tbro_, así que la cabeza no confunde tipos", () => {
    for (let i = 0; i < 500; i++) expect(generateToken().token.startsWith("tbro_")).toBe(false);
  });

  it("bearerFromHeader y prefixOf lo leen", () => {
    const { token, prefix } = generateToken("readonly");
    expect(bearerFromHeader(`Bearer ${token}`)).toBe(token);
    expect(prefixOf(token)).toBe(prefix);
    expect(prefixOf("tbro_short")).toBeNull();
    expect(prefixOf("xx_" + "a".repeat(43))).toBeNull();
  });

  it("checkToken exige que la cabeza y el tipo coincidan, en los dos sentidos", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    const ro = generateToken("readonly");
    const tb = generateToken("automation");
    const rec = (hash: string, kind: TokenRecord["kind"]): TokenRecord => ({
      id: "t1", name: "n", kind, token_hash: hash, expires_at: null, revoked_at: null,
    });
    expect(checkToken(rec(ro.hash, "readonly"), ro.token, now)?.kind).toBe("readonly");
    // Una fila readonly no responde a un tb_, que el proxy no confinaría a leer…
    expect(checkToken(rec(tb.hash, "readonly"), tb.token, now)).toBeNull();
    // …ni un tbro_ a una fila de otro tipo.
    expect(checkToken(rec(ro.hash, "automation"), ro.token, now)).toBeNull();
  });
});

describe("tokenActorKindOnly", () => {
  it("deja solo el tipo de una etiqueta de token: ni el nombre ni el prefijo", () => {
    const label = tokenActor({ name: "fin-cli", kind: "automation", prefix: "tb_AbCd1234" });
    expect(tokenActorKindOnly(label)).toBe("token:automation");
    expect(tokenActorKindOnly("token:agent:Claude · 1a2b3c4d (tb_ZzYy9876)")).toBe("token:agent");
    expect(tokenActorKindOnly("token:readonly:a:b:c (tbro_Abc12345)")).toBe("token:readonly");
  });

  it("lo demás vuelve igual", () => {
    for (const v of ["owner@example.com", "system", "token", "token:", null]) {
      expect(tokenActorKindOnly(v)).toBe(v);
    }
  });
});
