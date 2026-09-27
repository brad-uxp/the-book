import { describe, it, expect } from "vitest";
import {
  forwardedForLog,
  isMobilePublicPath,
  mobileAuthorizedParties,
  mobileTokenName,
} from "./mobile-auth";

describe("mobileAuthorizedParties", () => {
  const release = "348255215221-release.apps.googleusercontent.com";
  const debug = "348255215221-debug.apps.googleusercontent.com";

  it("en producción solo vale el cliente de release, aunque el de debug esté configurado", () => {
    expect(
      mobileAuthorizedParties({
        NODE_ENV: "production",
        MOBILE_ANDROID_CLIENT_ID: release,
        MOBILE_ANDROID_DEBUG_CLIENT_ID: debug,
      })
    ).toEqual([release]);
  });

  it("fuera de producción también acepta el de debug", () => {
    expect(
      mobileAuthorizedParties({
        NODE_ENV: "development",
        MOBILE_ANDROID_CLIENT_ID: release,
        MOBILE_ANDROID_DEBUG_CLIENT_ID: debug,
      })
    ).toEqual([release, debug]);
  });

  it("sin configurar devuelve vacío, y la ruta falla cerrada", () => {
    expect(mobileAuthorizedParties({ NODE_ENV: "production" })).toEqual([]);
    expect(mobileAuthorizedParties({ MOBILE_ANDROID_CLIENT_ID: "  " })).toEqual([]);
  });
});

describe("forwardedForLog", () => {
  it("solo registra, recortado; nunca decide nada", () => {
    expect(forwardedForLog(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(forwardedForLog(new Headers())).toBe("-");
    expect(forwardedForLog(new Headers({ "x-forwarded-for": "9".repeat(500) })).length).toBe(200);
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

describe("isMobilePublicPath", () => {
  it("solo las dos rutas exactas quedan fuera del login", () => {
    expect(isMobilePublicPath("/api/mobile/nonce")).toBe(true);
    expect(isMobilePublicPath("/api/mobile/sign-in")).toBe(true);
  });

  it.each([
    "/api/mobile/sign-out",
    "/api/mobile/sign-in/",
    "/api/mobile/nonce/",
    "/api/mobile/sign-in/extra",
    "/api/mobile/Sign-In",
    "/api/mobile/sign-in%2F..%2Fsettings",
    "/api/mobile/sign-in/../settings/tokens",
    "/api/mobile",
    "/api/mobile/",
    "/api/settings/tokens",
  ])("%s no es pública", (path) => {
    expect(isMobilePublicPath(path)).toBe(false);
  });
});
