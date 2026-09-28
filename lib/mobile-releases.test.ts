import { describe, it, expect } from "vitest";
import {
  decideCreate,
  decidePublish,
  isReleaseKey,
  isReleaseVersion,
  isSha256Hex,
  releaseKey,
} from "./mobile-releases";

describe("formas", () => {
  it("versión x.y.z", () => {
    expect(isReleaseVersion("0.4.3")).toBe(true);
    expect(isReleaseVersion("10.20.300")).toBe(true);
    expect(isReleaseVersion("0.4")).toBe(false);
    expect(isReleaseVersion("0.4.3-beta")).toBe(false);
    expect(isReleaseVersion("../0.4.3")).toBe(false);
  });

  it("sha256 en hexadecimal minúscula", () => {
    expect(isSha256Hex("a".repeat(64))).toBe(true);
    expect(isSha256Hex("A".repeat(64))).toBe(false);
    expect(isSha256Hex("a".repeat(63))).toBe(false);
  });

  it("la clave de R2 sale solo de campos validados y se reconoce", () => {
    const key = releaseKey("0.4.3", 7);
    expect(key).toBe("mobile/releases/book-0.4.3-7.apk");
    expect(isReleaseKey(key)).toBe(true);
  });

  it("no reconoce claves ajenas (facturas, rutas relativas, otra extensión)", () => {
    expect(isReleaseKey("invoices/x/y.pdf")).toBe(false);
    expect(isReleaseKey("mobile/releases/../invoices/a.pdf")).toBe(false);
    expect(isReleaseKey("mobile/releases/book-0.4.3-7.apk.exe")).toBe(false);
    expect(isReleaseKey("mobile/releases/evil.apk")).toBe(false);
  });
});

describe("decideCreate", () => {
  it("la primera versión se crea", () => {
    expect(decideCreate(7, null, null)).toEqual({ action: "create" });
  });

  it("tiene que superar a la última publicada", () => {
    expect(decideCreate(7, 6, null)).toEqual({ action: "create" });
    expect(decideCreate(6, 6, null).action).toBe("reject");
    expect(decideCreate(5, 6, null)).toMatchObject({ action: "reject", status: 409 });
  });

  it("reintenta una creada y no publicada (la subida falló)", () => {
    expect(decideCreate(7, 6, { id: "r7", published: false })).toEqual({ action: "retry", id: "r7" });
  });

  it("nunca pisa una publicada", () => {
    expect(decideCreate(7, null, { id: "r7", published: true })).toMatchObject({ action: "reject", status: 409 });
  });
});

describe("decidePublish", () => {
  const release = { published: false, size_bytes: 1000 };

  it("publica si R2 tiene exactamente los bytes declarados", () => {
    expect(decidePublish(release, 1000)).toEqual({ action: "publish" });
  });

  it("sin subida, o con otro tamaño, no publica", () => {
    expect(decidePublish(release, null)).toMatchObject({ action: "reject", status: 409 });
    expect(decidePublish(release, 999)).toMatchObject({ action: "reject", status: 409 });
  });

  it("inexistente → 404; ya publicada → 409", () => {
    expect(decidePublish(null, 1000)).toMatchObject({ action: "reject", status: 404 });
    expect(decidePublish({ published: true, size_bytes: 1000 }, 1000)).toMatchObject({ action: "reject", status: 409 });
  });
});
