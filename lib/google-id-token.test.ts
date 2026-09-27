import { describe, it, expect, beforeAll } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTVerifyGetKey,
} from "jose";
import { checkGoogleClaims, verifyGoogleIdToken } from "./google-id-token";

const AUD = "348255215221-web.apps.googleusercontent.com";
const ALLOWED = ["owner@example.com"];
const NOW = new Date("2026-09-27T20:00:00Z");
const nowS = Math.floor(NOW.getTime() / 1000);

const good = {
  iss: "https://accounts.google.com",
  aud: AUD,
  azp: "348255215221-android.apps.googleusercontent.com",
  sub: "1234567890",
  email: "owner@example.com",
  email_verified: true,
  iat: nowS - 10,
  exp: nowS + 3600,
  nonce: "n-abc",
};
const opts = { audience: AUD, allowedEmails: ALLOWED, now: NOW };

describe("checkGoogleClaims", () => {
  it("acepta un token válido y devuelve email, sub y nonce", () => {
    expect(checkGoogleClaims(good, opts)).toEqual({
      ok: true,
      email: "owner@example.com",
      subject: "1234567890",
      nonce: "n-abc",
    });
  });

  it("acepta el issuer con y sin https", () => {
    expect(checkGoogleClaims({ ...good, iss: "accounts.google.com" }, opts).ok).toBe(true);
  });

  it.each([
    ["issuer ajeno", { iss: "https://evil.example.com" }, "issuer"],
    ["audience de otra app", { aud: "otra-app.apps.googleusercontent.com" }, "audience"],
    ["audience compartida con otra", { aud: [AUD, "otra"] }, "audience"],
    ["vencido", { exp: nowS - 60 }, "expired"],
    ["sin exp", { exp: undefined }, "expired"],
    ["emitido en el futuro", { iat: nowS + 3600 }, "issued_in_future"],
    ["sin sub", { sub: "" }, "subject"],
    ["sin email", { email: undefined }, "email_missing"],
    ["email sin verificar", { email_verified: false }, "email_unverified"],
    ["email fuera del allowlist", { email: "intruso@example.com" }, "email_not_allowed"],
    ["sin nonce", { nonce: undefined }, "nonce_missing"],
  ] as const)("rechaza: %s", (_label, patch, reason) => {
    expect(checkGoogleClaims({ ...good, ...patch } as never, opts)).toEqual({
      ok: false,
      reason,
    });
  });

  it("acepta email_verified como el string \"true\" (formato histórico de Google)", () => {
    expect(checkGoogleClaims({ ...good, email_verified: "true" }, opts).ok).toBe(true);
  });

  it("acepta una audience en array solo si es exactamente la nuestra", () => {
    expect(checkGoogleClaims({ ...good, aud: [AUD] }, opts).ok).toBe(true);
  });

  it("tolera 30 s de desfasaje de reloj, no más", () => {
    expect(checkGoogleClaims({ ...good, exp: nowS - 20 }, opts).ok).toBe(true);
    expect(checkGoogleClaims({ ...good, exp: nowS - 31 }, opts).ok).toBe(false);
  });
});

describe("verifyGoogleIdToken (firma real, llaves locales)", () => {
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;
  let keys: JWTVerifyGetKey;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair("RS256")).privateKey;
    const jwk = await exportJWK(pair.publicKey);
    keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] });
  });

  const sign = (claims: Record<string, unknown>, key = privateKey, alg = "RS256") =>
    new SignJWT(claims).setProtectedHeader({ alg, kid: "k1" }).sign(key);

  const realNow = () => Math.floor(Date.now() / 1000);

  it("verifica un token firmado con la llave publicada", async () => {
    const t = await sign({ ...good, iat: realNow(), exp: realNow() + 600 });
    const payload = await verifyGoogleIdToken(t, AUD, keys);
    expect(payload.email).toBe("owner@example.com");
  });

  it("rechaza un token firmado con otra llave", async () => {
    const t = await sign({ ...good, iat: realNow(), exp: realNow() + 600 }, otherKey);
    await expect(verifyGoogleIdToken(t, AUD, keys)).rejects.toThrow();
  });

  it("rechaza otra audience, otro issuer y un token vencido", async () => {
    const base = { ...good, iat: realNow(), exp: realNow() + 600 };
    await expect(verifyGoogleIdToken(await sign({ ...base, aud: "otra" }), AUD, keys)).rejects.toThrow();
    await expect(verifyGoogleIdToken(await sign({ ...base, iss: "https://evil" }), AUD, keys)).rejects.toThrow();
    await expect(
      verifyGoogleIdToken(await sign({ ...base, exp: realNow() - 3600 }), AUD, keys)
    ).rejects.toThrow();
  });

  it("rechaza un token sin firma (alg none) y uno alterado", async () => {
    const t = await sign({ ...good, iat: realNow(), exp: realNow() + 600 });
    const [h, p] = t.split(".");
    const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url")}.${p}.`;
    await expect(verifyGoogleIdToken(none, AUD, keys)).rejects.toThrow();

    const forged = Buffer.from(
      JSON.stringify({ ...good, email: "intruso@example.com", iat: realNow(), exp: realNow() + 600 })
    ).toString("base64url");
    await expect(verifyGoogleIdToken(`${h}.${forged}.${t.split(".")[2]}`, AUD, keys)).rejects.toThrow();
  });
});
