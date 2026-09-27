import { describe, it, expect, beforeEach } from "vitest";
import {
  NONCE_TTL_MS,
  checkNonce,
  consumeNonce,
  issueNonce,
  resetUsedNonces,
} from "./mobile-nonce";

const SECRET = "test-secret-for-nonces";
const T = 1_790_000_000_000;

beforeEach(() => resetUsedNonces());

describe("issueNonce / checkNonce", () => {
  it("un nonce recién emitido es válido y dura cinco minutos", () => {
    const { nonce, expiresAt } = issueNonce(SECRET, T);
    expect(expiresAt).toBe(T + NONCE_TTL_MS);
    expect(checkNonce(nonce, SECRET, T)).toBe("ok");
    expect(checkNonce(nonce, SECRET, T + NONCE_TTL_MS - 1)).toBe("ok");
    expect(checkNonce(nonce, SECRET, T + NONCE_TTL_MS)).toBe("expired");
  });

  it("dos nonces nunca son iguales", () => {
    const a = issueNonce(SECRET, T).nonce;
    const b = issueNonce(SECRET, T).nonce;
    expect(a).not.toBe(b);
  });

  it("emitir no guarda nada: mil nonces no desplazan al del dueño", () => {
    const mine = issueNonce(SECRET, T).nonce;
    for (let i = 0; i < 1000; i++) issueNonce(SECRET, T);
    expect(consumeNonce(mine, SECRET, T + 1000)).toBe(true);
  });

  it("firmado con otro secreto no pasa", () => {
    const { nonce } = issueNonce("otro-secreto", T);
    expect(checkNonce(nonce, SECRET, T)).toBe("forged");
  });

  it("cambiar el vencimiento o la firma lo invalida", () => {
    const { nonce } = issueNonce(SECRET, T);
    const [body, tag] = nonce.split(".");
    const bytes = Buffer.from(body, "base64url");
    bytes.writeBigUInt64BE(BigInt(T + 365 * 24 * 3600 * 1000), 0); // estirar la vida
    expect(checkNonce(`${bytes.toString("base64url")}.${tag}`, SECRET, T)).toBe("forged");
    const badTag = Buffer.from(tag, "base64url");
    badTag[0] ^= 1;
    expect(checkNonce(`${body}.${badTag.toString("base64url")}`, SECRET, T)).toBe("forged");
  });

  it.each([
    ["vacío", ""],
    ["null", null],
    ["sin punto", "abc"],
    ["tres partes", "a.b.c"],
    ["cuerpo corto", "AAAA.BBBB"],
    ["demasiado largo", "x".repeat(500)],
  ])("rechaza lo malformado: %s", (_l, n) => {
    expect(checkNonce(n as string | null, SECRET, T)).toBe("malformed");
  });
});

describe("consumeNonce", () => {
  it("vale una sola vez", () => {
    const { nonce } = issueNonce(SECRET, T);
    expect(consumeNonce(nonce, SECRET, T + 1)).toBe(true);
    expect(consumeNonce(nonce, SECRET, T + 2)).toBe(false);
    expect(checkNonce(nonce, SECRET, T + 2)).toBe("replayed");
  });

  it("uno vencido, falsificado o malformado no se consume", () => {
    const { nonce } = issueNonce(SECRET, T);
    expect(consumeNonce(nonce, SECRET, T + NONCE_TTL_MS)).toBe(false);
    expect(consumeNonce(issueNonce("otro", T).nonce, SECRET, T)).toBe(false);
    expect(consumeNonce("basura", SECRET, T)).toBe(false);
  });

  it("los usados se olvidan al vencer, así el registro no crece", () => {
    const a = issueNonce(SECRET, T).nonce;
    consumeNonce(a, SECRET, T + 1);
    // Después de su vencimiento, a es "expired" antes que "replayed": se puede
    // podar sin reabrir nada.
    const b = issueNonce(SECRET, T + NONCE_TTL_MS + 10).nonce;
    consumeNonce(b, SECRET, T + NONCE_TTL_MS + 11);
    expect(checkNonce(a, SECRET, T + NONCE_TTL_MS + 12)).toBe("expired");
  });
});
