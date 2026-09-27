import { describe, it, expect, beforeEach } from "vitest";
import { MAX_PENDING_NONCES, NONCE_TTL_MS, consumeNonce, issueNonce, resetNonces } from "./mobile-nonce";

beforeEach(() => resetNonces());

describe("nonces de sign-in mobile", () => {
  it("un nonce emitido se acepta una sola vez", () => {
    const { nonce } = issueNonce(1000);
    expect(consumeNonce(nonce, 2000)).toBe(true);
    expect(consumeNonce(nonce, 2000)).toBe(false);
  });

  it("vence a los 5 minutos", () => {
    const { nonce, expiresAt } = issueNonce(0);
    expect(expiresAt).toBe(NONCE_TTL_MS);
    expect(consumeNonce(nonce, NONCE_TTL_MS)).toBe(false);
  });

  it("uno inventado, vacío o ausente no pasa", () => {
    expect(consumeNonce("inventado")).toBe(false);
    expect(consumeNonce("")).toBe(false);
    expect(consumeNonce(null)).toBe(false);
    expect(consumeNonce(undefined)).toBe(false);
  });

  it("son impredecibles: 32 caracteres base64url, distintos entre sí", () => {
    const seen = new Set(Array.from({ length: 200 }, () => issueNonce().nonce));
    expect(seen.size).toBe(200);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("una avalancha de pedidos no hace crecer el mapa sin límite", () => {
    const first = issueNonce(0).nonce;
    for (let i = 0; i < MAX_PENDING_NONCES + 50; i++) issueNonce(0);
    // El más viejo se descartó para hacer lugar.
    expect(consumeNonce(first, 1)).toBe(false);
  });
});
