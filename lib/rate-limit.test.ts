import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, pruneRateLimits, resetRateLimits } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(resetRateLimits);

  it("permite hasta el límite y rechaza el siguiente", () => {
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("tok", t, 5, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit("tok", t, 5, 60_000).allowed).toBe(false);
  });

  it("informa cuánto falta para reintentar", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("tok", t, 3, 60_000);
    const v = checkRateLimit("tok", t + 15_000, 3, 60_000);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSeconds).toBe(45);
  });

  it("nunca sugiere reintentar en 0 segundos", () => {
    const t = 1_000_000;
    checkRateLimit("tok", t, 1, 60_000);
    const v = checkRateLimit("tok", t + 59_999, 1, 60_000);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("abre una ventana nueva al vencer la anterior", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("tok", t, 3, 60_000);
    expect(checkRateLimit("tok", t, 3, 60_000).allowed).toBe(false);
    expect(checkRateLimit("tok", t + 60_000, 3, 60_000).allowed).toBe(true);
  });

  it("cuenta cada token por separado", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("a", t, 3, 60_000);
    expect(checkRateLimit("a", t, 3, 60_000).allowed).toBe(false);
    // El token b no arrastra el consumo de a.
    expect(checkRateLimit("b", t, 3, 60_000).allowed).toBe(true);
  });

  it("descuenta el restante", () => {
    const t = 1_000_000;
    expect(checkRateLimit("tok", t, 3, 60_000).remaining).toBe(2);
    expect(checkRateLimit("tok", t, 3, 60_000).remaining).toBe(1);
    expect(checkRateLimit("tok", t, 3, 60_000).remaining).toBe(0);
  });
});

describe("pruneRateLimits", () => {
  beforeEach(resetRateLimits);

  it("libera las ventanas vencidas y conserva las vivas", () => {
    const t = 1_000_000;
    checkRateLimit("viejo", t, 5, 10_000);
    checkRateLimit("nuevo", t, 5, 60_000);

    pruneRateLimits(t + 20_000);

    // "viejo" fue purgado: vuelve a empezar de cero.
    expect(checkRateLimit("viejo", t + 20_000, 1, 60_000).allowed).toBe(true);
    expect(checkRateLimit("viejo", t + 20_000, 1, 60_000).allowed).toBe(false);
    // "nuevo" sigue en su ventana original.
    expect(checkRateLimit("nuevo", t + 20_000, 2, 60_000).allowed).toBe(true);
    expect(checkRateLimit("nuevo", t + 20_000, 2, 60_000).allowed).toBe(false);
  });
});
