import webpush from "web-push";
import { prisma } from "@/lib/db";

let vapidInitialized = false;

function ensureVapid() {
  if (vapidInitialized) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("[web-push] VAPID keys not configured");
  }
  webpush.setVapidDetails("mailto:notifications@thebook.app", publicKey, privateKey);
  vapidInitialized = true;
}

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendWebPushToAll(payload: PushPayload) {
  ensureVapid();
  const subscriptions = await prisma.pushSubscription.findMany();
  if (subscriptions.length === 0) return;

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      )
    )
  );

  // Clean up expired subscriptions (410 Gone)
  const expiredIds: string[] = [];
  results.forEach((result, idx) => {
    if (
      result.status === "rejected" &&
      (result.reason as any)?.statusCode === 410
    ) {
      expiredIds.push(subscriptions[idx].id);
    }
  });

  if (expiredIds.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { id: { in: expiredIds } },
    });
    console.log(`[web-push] Cleaned up ${expiredIds.length} expired subscriptions`);
  }

  const failed = results.filter(
    (r) =>
      r.status === "rejected" &&
      !(expiredIds.length > 0 && (r.reason as any)?.statusCode === 410)
  );
  if (failed.length > 0) {
    console.error(`[web-push] ${failed.length}/${subscriptions.length} pushes failed`);
  }
}
