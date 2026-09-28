import { SignJWT, importPKCS8 } from "jose";

/**
 * Sending push messages to the phone through Firebase Cloud Messaging (FCM),
 * HTTP v1 — the only push channel Android has.
 *
 * What travels through Google is deliberately empty: data-only messages that
 * say "something happened" ({ kind, id }), never a title, a body, an amount or
 * a name. The app wakes up, asks OUR API for the details with its own token and
 * shows the notification itself. No `notification` block either: with one,
 * Android would draw it without the app and the content would have to be in
 * the message.
 *
 * Never Expo's push service: the app registers its native FCM token and this
 * server talks to FCM directly, so no third party beyond Google's transport
 * sees even the fact that a message was sent.
 *
 * Credentials: FCM_SERVICE_ACCOUNT_JSON, a service account that can only send
 * FCM messages (book-push-sender@…). It is exchanged for a short-lived OAuth
 * access token (a JWT we sign with its key, RS256, at the account's token_uri),
 * cached until shortly before it expires. The key and the tokens are never
 * logged.
 *
 * Everything decidable without the network is a pure function here, tested;
 * createFcmClient() is the thin I/O around them.
 */

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
export const FCM_API_BASE = "https://fcm.googleapis.com";

/** How long a push is worth delivering. A due-date reminder a day late is noise. */
export const PUSH_TTL = "86400s";

/** Per request: FCM and the token endpoint answer in well under a second. */
export const FCM_TIMEOUT_MS = 10_000;

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

/**
 * What the phone is told. Values are strings: FCM's `data` map is
 * string→string.
 *
 * - notification: a row of the in-app notification centre (the daily job's);
 *   the app fetches GET /api/notifications/:id.
 * - test: the owner's "Send test notification"; the app shows a fixed text.
 */
export type PushData = { kind: "notification"; id: string } | { kind: "test" };

/**
 * Reads FCM_SERVICE_ACCOUNT_JSON. Null when absent or not a service account —
 * push is then off and the caller logs why, once. `production` pins the token
 * endpoint to Google's: a service account whose token_uri points elsewhere
 * would hand our signed assertion to that host.
 */
export function parseServiceAccount(
  raw: string | undefined,
  { production }: { production: boolean }
): ServiceAccount | null {
  if (!raw || !raw.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === "string" && (v[k] as string).trim() ? (v[k] as string) : null);
  const project_id = str("project_id");
  const client_email = str("client_email");
  const private_key = str("private_key");
  const token_uri = str("token_uri") ?? GOOGLE_TOKEN_URI;
  if (!project_id || !client_email || !private_key) return null;
  if (v.type !== undefined && v.type !== "service_account") return null;
  if (!/^[a-z][a-z0-9-]{4,}$/.test(project_id)) return null;
  if (!private_key.includes("PRIVATE KEY")) return null;
  if (production && token_uri !== GOOGLE_TOKEN_URI) return null;
  return { project_id, client_email, private_key, token_uri };
}

/** The HTTP v1 body for one device: data-only, high priority, a day to live. */
export function fcmMessage(fcmToken: string, data: PushData) {
  const payload: Record<string, string> =
    data.kind === "notification" ? { kind: data.kind, id: data.id } : { kind: data.kind };
  return {
    message: {
      token: fcmToken,
      data: payload,
      // High priority is what lets a data message wake the app under Doze.
      android: { priority: "HIGH", ttl: PUSH_TTL },
    },
  };
}

export type SendResult = "sent" | "unregistered" | "failed";

/**
 * What an FCM error means for the device row. Only a token FCM says is gone
 * (UNREGISTERED), or one it rejects as malformed, justifies deleting the
 * device; anything else — our credentials, quota, a bad payload, an outage —
 * is our problem, and the device stays.
 */
export function classifyFcmError(status: number, body: unknown): SendResult {
  const err = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error;
  const details = Array.isArray(err?.details) ? (err.details as Record<string, unknown>[]) : [];
  const codes = details.map((d) => d?.errorCode).filter((c): c is string => typeof c === "string");
  if (status === 404 || codes.includes("UNREGISTERED")) return "unregistered";
  if (status === 400 && err?.status === "INVALID_ARGUMENT") {
    const aboutToken = details.some((d) =>
      Array.isArray(d?.fieldViolations)
        ? (d.fieldViolations as { field?: unknown }[]).some((f) => f?.field === "message.token")
        : false
    );
    if (aboutToken) return "unregistered";
  }
  return "failed";
}

/** Whether a cached access token is still good for another request. */
export function tokenStillValid(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs - nowMs > 60_000;
}

export interface FcmClient {
  send(fcmToken: string, data: PushData): Promise<SendResult>;
}

/**
 * The I/O: an access token from the service account (cached), then one POST
 * per device. `apiBase` exists for tests against a local fake FCM; callers
 * pass FCM_API_BASE in production.
 */
export function createFcmClient({
  serviceAccount,
  apiBase = FCM_API_BASE,
  fetchImpl = fetch,
  now = () => Date.now(),
}: {
  serviceAccount: ServiceAccount;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): FcmClient {
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function fetchAccessToken(): Promise<string> {
    const key = await importPKCS8(serviceAccount.private_key, "RS256");
    const iat = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: FCM_SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(serviceAccount.client_email)
      .setSubject(serviceAccount.client_email)
      .setAudience(serviceAccount.token_uri)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    const res = await fetchImpl(serviceAccount.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string") throw new Error("token endpoint gave no access_token");
    const ttl = typeof body.expires_in === "number" ? body.expires_in : 3600;
    cached = { token: body.access_token, expiresAt: now() + ttl * 1000 };
    return body.access_token;
  }

  async function accessToken(): Promise<string> {
    if (cached && tokenStillValid(cached.expiresAt, now())) return cached.token;
    // One exchange at a time: the daily job sends to several devices at once.
    pending ??= fetchAccessToken().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    async send(fcmToken, data) {
      const token = await accessToken();
      const url = `${apiBase}/v1/projects/${serviceAccount.project_id}/messages:send`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(fcmMessage(fcmToken, data)),
        signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
      });
      if (res.ok) return "sent";
      if (res.status === 401) cached = null; // The next send exchanges again.
      const body = await res.json().catch(() => null);
      return classifyFcmError(res.status, body);
    },
  };
}
