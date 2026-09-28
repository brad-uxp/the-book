import { prisma } from "@/lib/db";
import {
  FCM_API_BASE,
  createFcmClient,
  parseServiceAccount,
  type FcmClient,
  type PushData,
  type SendResult,
} from "@/lib/fcm";

/**
 * Native push, the database side: which phones get a push, and what happens
 * to a phone FCM says is gone. The FCM protocol itself is lib/fcm.ts.
 *
 * Best effort by design. A push that cannot be sent is logged and counted,
 * never thrown at the caller: the daily job, a sign-out or a test button must
 * not fail because Google's transport did.
 */

let client: FcmClient | null | undefined;

/**
 * The FCM client, built on first use from FCM_SERVICE_ACCOUNT_JSON. Null —
 * push off, said once in the log — when the variable is missing or is not a
 * service account. FCM_API_BASE (a local fake FCM) is honoured only outside
 * production.
 */
function fcm(): FcmClient | null {
  if (client !== undefined) return client;
  const production = process.env.NODE_ENV === "production";
  const serviceAccount = parseServiceAccount(process.env.FCM_SERVICE_ACCOUNT_JSON, { production });
  if (!serviceAccount) {
    console.warn("[push] FCM_SERVICE_ACCOUNT_JSON is missing or not a service account: push is off");
    client = null;
    return null;
  }
  const apiBase = !production && process.env.FCM_API_BASE ? process.env.FCM_API_BASE : FCM_API_BASE;
  client = createFcmClient({ serviceAccount, apiBase });
  return client;
}

/** Test seam: forget the client so the next send re-reads the environment. */
export function resetPushClient(): void {
  client = undefined;
}

export interface PushOutcome {
  sent: number;
  /** Devices FCM no longer knows (uninstalled, token rotated): deleted. */
  removed: number;
  failed: number;
  /** Push is not configured on this server. */
  off?: true;
}

/**
 * Devices a push may go to: their token must still be able to sign in — not
 * revoked, not expired, and the phone's kind. Revoking deletes the device too
 * (forgetDevice), so this is the second lock, not the only one.
 */
function liveDevices(now: Date) {
  return {
    api_token: {
      kind: "mobile" as const,
      revoked_at: null,
      OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    },
  };
}

async function deliver(devices: { id: string; fcm_token: string }[], data: PushData): Promise<PushOutcome> {
  const c = fcm();
  if (!c) return { sent: 0, removed: 0, failed: 0, off: true };
  const outcome: PushOutcome = { sent: 0, removed: 0, failed: 0 };
  for (const [i, device] of devices.entries()) {
    let result: SendResult;
    try {
      result = await c.send(device.fcm_token, data);
    } catch (err) {
      // Network, timeout, the token exchange: not about this device, so the
      // rest would fail the same way, 10 s each. Stop and count them failed.
      // Never the FCM token in the log.
      console.error(`[push] device ${device.id}: ${err instanceof Error ? err.message : "send failed"}`);
      outcome.failed += devices.length - i;
      break;
    }
    if (result === "sent") outcome.sent++;
    else if (result === "unregistered") {
      outcome.removed++;
      await prisma.mobileDevice.delete({ where: { id: device.id } }).catch(() => undefined);
    } else outcome.failed++;
  }
  return outcome;
}

/** A push to every live phone. */
export async function pushToAll(data: PushData): Promise<PushOutcome> {
  const devices = await prisma.mobileDevice.findMany({
    where: liveDevices(new Date()),
    select: { id: true, fcm_token: true },
  });
  return deliver(devices, data);
}

/** A push to the phone signed in with this API token, if it registered one. */
export async function pushToToken(apiTokenId: string, data: PushData): Promise<PushOutcome | "no_device"> {
  const device = await prisma.mobileDevice.findFirst({
    where: { api_token_id: apiTokenId, ...liveDevices(new Date()) },
    select: { id: true, fcm_token: true },
  });
  if (!device) return "no_device";
  return deliver([device], data);
}

/**
 * The phone's FCM token for this API token: one device per token (one install
 * signs in once). If the same FCM token was registered under another API
 * token — the app signed out and in again — it moves here.
 */
export async function registerDevice(input: {
  apiTokenId: string;
  fcmToken: string;
  platform: string;
  appVersion: string | null;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.mobileDevice.deleteMany({
      where: { fcm_token: input.fcmToken, NOT: { api_token_id: input.apiTokenId } },
    });
    return tx.mobileDevice.upsert({
      where: { api_token_id: input.apiTokenId },
      create: {
        api_token_id: input.apiTokenId,
        fcm_token: input.fcmToken,
        platform: input.platform,
        app_version: input.appVersion,
      },
      update: {
        fcm_token: input.fcmToken,
        platform: input.platform,
        app_version: input.appVersion,
        last_seen_at: new Date(),
      },
      select: { id: true },
    });
  });
}

/** Stops pushes to the phone of this API token (sign-out, revocation). */
export async function forgetDevice(apiTokenId: string): Promise<number> {
  const { count } = await prisma.mobileDevice.deleteMany({ where: { api_token_id: apiTokenId } });
  return count;
}
