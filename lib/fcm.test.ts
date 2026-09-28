import { describe, it, expect, beforeAll } from "vitest";
import { exportPKCS8, generateKeyPair, jwtVerify, type CryptoKey } from "jose";
import {
  FCM_SCOPE,
  GOOGLE_TOKEN_URI,
  classifyFcmError,
  createFcmClient,
  fcmMessage,
  parseServiceAccount,
  tokenStillValid,
} from "./fcm";

let pem = "";
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  pem = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

const account = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "service_account",
    project_id: "uxprogramming-crm",
    client_email: "book-push-sender@uxprogramming-crm.iam.gserviceaccount.com",
    private_key: pem,
    token_uri: GOOGLE_TOKEN_URI,
    ...over,
  });

describe("parseServiceAccount", () => {
  it("lee una cuenta de servicio válida", () => {
    const sa = parseServiceAccount(account(), { production: true });
    expect(sa?.project_id).toBe("uxprogramming-crm");
    expect(sa?.token_uri).toBe(GOOGLE_TOKEN_URI);
  });

  it.each([
    ["ausente", undefined],
    ["vacía", "  "],
    ["no es JSON", "{nope"],
    ["sin clave privada", JSON.stringify({ project_id: "uxprogramming-crm", client_email: "a@b" })],
    ["otro tipo de credencial", null],
  ])("%s → null (push apagado)", (_label, raw) => {
    const value = raw === null ? account({ type: "authorized_user" }) : raw;
    expect(parseServiceAccount(value as string | undefined, { production: true })).toBeNull();
  });

  it("en producción, un token_uri que no es el de Google se rechaza", () => {
    expect(parseServiceAccount(account({ token_uri: "https://evil.example/token" }), { production: true })).toBeNull();
    expect(parseServiceAccount(account({ token_uri: "http://127.0.0.1:3029/token" }), { production: false })?.token_uri).toBe(
      "http://127.0.0.1:3029/token"
    );
  });
});

describe("fcmMessage", () => {
  it("es solo datos: sin bloque notification, prioridad alta, un día de vida", () => {
    const m = fcmMessage("tok", { kind: "notification", id: "n1" });
    expect(m).toEqual({
      message: { token: "tok", data: { kind: "notification", id: "n1" }, android: { priority: "HIGH", ttl: "86400s" } },
    });
    expect(JSON.stringify(m)).not.toContain('"notification":{');
  });

  it("la prueba no lleva id", () => {
    expect(fcmMessage("tok", { kind: "test" }).message.data).toEqual({ kind: "test" });
  });
});

describe("classifyFcmError", () => {
  it("UNREGISTERED: el dispositivo ya no existe", () => {
    expect(classifyFcmError(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } })).toBe("unregistered");
  });

  it("un 404 sin UNREGISTERED no borra nada (p. ej. un project id mal configurado)", () => {
    expect(classifyFcmError(404, null)).toBe("failed");
    expect(classifyFcmError(404, { error: { status: "NOT_FOUND" } })).toBe("failed");
  });

  it("INVALID_ARGUMENT sobre el token: el token no sirve", () => {
    const body = {
      error: {
        status: "INVALID_ARGUMENT",
        details: [{ fieldViolations: [{ field: "message.token", description: "Invalid registration token" }] }],
      },
    };
    expect(classifyFcmError(400, body)).toBe("unregistered");
  });

  it("cualquier otro error es nuestro: el dispositivo se queda", () => {
    expect(classifyFcmError(400, { error: { status: "INVALID_ARGUMENT", details: [] } })).toBe("failed");
    expect(classifyFcmError(401, { error: { status: "UNAUTHENTICATED" } })).toBe("failed");
    expect(classifyFcmError(429, null)).toBe("failed");
    expect(classifyFcmError(503, null)).toBe("failed");
  });
});

describe("tokenStillValid", () => {
  it("renueva un minuto antes de que venza", () => {
    expect(tokenStillValid(1_000_000, 1_000_000 - 61_000)).toBe(true);
    expect(tokenStillValid(1_000_000, 1_000_000 - 59_000)).toBe(false);
  });
});

describe("createFcmClient", () => {
  type Call = { url: string; init: RequestInit };

  function fakeFetch(calls: Call[], sendStatus: number[] = []) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/token")) {
        return new Response(JSON.stringify({ access_token: `at-${calls.length}`, expires_in: 3600 }), { status: 200 });
      }
      const status = sendStatus.shift() ?? 200;
      const body =
        status === 200
          ? { name: "projects/uxprogramming-crm/messages/1" }
          : { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } };
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  }

  it("intercambia un JWT firmado por un access token, lo reutiliza y manda solo datos", async () => {
    const calls: Call[] = [];
    let t = Date.UTC(2026, 8, 28, 12);
    const sa = parseServiceAccount(account({ token_uri: "http://fake/token" }), { production: false })!;
    const client = createFcmClient({ serviceAccount: sa, apiBase: "http://fake", fetchImpl: fakeFetch(calls), now: () => t });

    expect(await client.send("device-1", { kind: "notification", id: "n1" })).toBe("sent");
    expect(await client.send("device-2", { kind: "test" })).toBe("sent");

    // One token exchange for two sends.
    expect(calls.map((c) => c.url)).toEqual([
      "http://fake/token",
      "http://fake/v1/projects/uxprogramming-crm/messages:send",
      "http://fake/v1/projects/uxprogramming-crm/messages:send",
    ]);

    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const { payload } = await jwtVerify(form.get("assertion")!, publicKey, {
      audience: "http://fake/token",
      issuer: sa.client_email,
      currentDate: new Date(t),
    });
    expect(payload.scope).toBe(FCM_SCOPE);
    // Emitido 30 s antes, por si el reloj del servidor adelanta.
    expect(payload.iat).toBe(Math.floor(t / 1000) - 30);

    const send = calls[1];
    expect((send.init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
    expect(JSON.parse(String(send.init.body))).toEqual(fcmMessage("device-1", { kind: "notification", id: "n1" }));

    // After it expires, a new exchange.
    t += 3600_000;
    await client.send("device-1", { kind: "test" });
    expect(calls.filter((c) => c.url.endsWith("/token"))).toHaveLength(2);
  });

  it("un token dado de baja vuelve como unregistered", async () => {
    const calls: Call[] = [];
    const sa = parseServiceAccount(account({ token_uri: "http://fake/token" }), { production: false })!;
    const client = createFcmClient({ serviceAccount: sa, apiBase: "http://fake", fetchImpl: fakeFetch(calls, [404]) });
    expect(await client.send("gone", { kind: "test" })).toBe("unregistered");
  });
});
