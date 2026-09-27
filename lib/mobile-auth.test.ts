import { describe, it, expect } from "vitest";
import { clientIp, mobileTokenName } from "./mobile-auth";

describe("clientIp", () => {
  it("toma la última entrada de X-Forwarded-For, la que agrega nuestro proxy", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 203.0.113.9" });
    expect(clientIp(h)).toBe("203.0.113.9");
  });

  it("un cliente que inventa la primera entrada no elige su bucket", () => {
    const a = new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    const b = new Headers({ "x-forwarded-for": "2.2.2.2, 203.0.113.9" });
    expect(clientIp(a)).toBe(clientIp(b));
  });

  it("cae a X-Real-IP y después a unknown", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("mobileTokenName", () => {
  it("dice que es el teléfono y cuál", () => {
    expect(mobileTokenName("Pixel 8")).toBe("mobile · Pixel 8");
  });

  it("limpia espacios y no pasa de 60 caracteres", () => {
    expect(mobileTokenName("  Pixel   8  ")).toBe("mobile · Pixel 8");
    expect(mobileTokenName("x".repeat(100)).length).toBe(60);
    expect(mobileTokenName("   ")).toBe("mobile · Android");
  });
});
