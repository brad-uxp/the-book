"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerPushSubscription() {
  if (!VAPID_PUBLIC_KEY) return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const registration = await navigator.serviceWorker.ready;
  const existingSub = await registration.pushManager.getSubscription();

  // Already subscribed — sync with backend in case it was lost
  if (existingSub) {
    await sendSubscriptionToServer(existingSub);
    return;
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  await sendSubscriptionToServer(subscription);
}

async function sendSubscriptionToServer(subscription: PushSubscription) {
  const body = subscription.toJSON();
  await fetch("/api/web-push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: body.endpoint,
      keys: body.keys,
    }),
  });
}

export function WebPushRegister() {
  const { data: session } = useSession();

  useEffect(() => {
    if (!session?.user) return;
    // Small delay to not block initial render
    const timeout = setTimeout(() => {
      registerPushSubscription().catch((err) =>
        console.warn("[web-push] Registration failed:", err)
      );
    }, 3000);
    return () => clearTimeout(timeout);
  }, [session?.user]);

  return null;
}
