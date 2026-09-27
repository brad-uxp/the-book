import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import { checkNonce } from "@/lib/mobile-nonce";

const SECRET = "nonce-route-secret";

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("POST /api/mobile/nonce", () => {
  it("devuelve un nonce firmado que el sign-in acepta, sin caché", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { nonce, expires_at } = await res.json();
    expect(checkNonce(nonce, SECRET)).toBe("ok");
    expect(new Date(expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("sin límite por IP: cientos seguidos siguen funcionando", async () => {
    for (let i = 0; i < 300; i++) expect((await POST()).status).toBe(200);
  });

  it("sin AUTH_SECRET no emite nada (503)", async () => {
    delete process.env.AUTH_SECRET;
    expect((await POST()).status).toBe(503);
  });
});
