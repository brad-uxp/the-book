import { useCallback, useEffect, useRef } from "react";
import { Alert, Linking } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { getDb } from "@/db/database";
import { getIssue } from "@/db/repo";
import { ApiError, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { kindOf } from "@/lib/issues";
import { installedVersion } from "../../modules/app-update";
import { targetFor } from "./payload";
import { deviceAppVersion } from "./version";
import { ensureChannel } from "./task";

/**
 * Push, the signed-in half: asks for permission once (explained, after
 * sign-in — never on a cold first launch), registers the phone's native FCM
 * token with book. (never Expo's push service), keeps it fresh, and opens the
 * right screen when a notification is tapped. Rendered only while signed in.
 */

const ASKED_KEY = "book.push-asked";
const REGISTERED_KEY = "book.push-registered";

function appVersion(): string | undefined {
  try {
    return deviceAppVersion(installedVersion());
  } catch {
    return undefined;
  }
}

/** Registers this phone's FCM token with the server. Best effort. */
export async function registerDevice(apiToken: string, fcmToken?: string): Promise<boolean> {
  try {
    const token = fcmToken ?? (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof token !== "string" || !token) return false;
    await apiRequest("/api/mobile/devices", {
      method: "POST",
      token: apiToken,
      body: { fcm_token: token, platform: "android", app_version: appVersion() },
    });
    await SecureStore.setItemAsync(REGISTERED_KEY, "1");
    return true;
  } catch (err) {
    console.warn("[push] register", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Asks Android for permission (13+); true when notifications may be shown. */
async function requestPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * The account menu's "Test notification": makes sure notifications are on and
 * the phone is registered, then asks the server for a test push — now, or in
 * 10 s so the app can be closed first and delivery checked in the background.
 */
export async function sendTestNotification(apiToken: string, delaySeconds: 0 | 10): Promise<string> {
  await ensureChannel();
  if (!(await requestPermission())) {
    Alert.alert("Notifications are off", "Turn them on for book. in Android's settings to get reminders.", [
      { text: "Not now", style: "cancel" },
      { text: "Open settings", onPress: () => void Linking.openSettings() },
    ]);
    return "Notifications are off";
  }
  if (!(await registerDevice(apiToken))) return "Couldn't register this phone. Try again.";
  try {
    const res = await apiRequest<{ status: string }>("/api/mobile/devices/test", {
      method: "POST",
      token: apiToken,
      body: delaySeconds ? { delay_seconds: delaySeconds } : {},
    });
    if (res.status === "scheduled") return "Test on its way in 10 seconds — close book. to see it arrive";
    return "Test sent";
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) return "Push isn't set up on the server yet";
    return err instanceof Error ? err.message : "The test didn't go out";
  }
}

export function PushManager() {
  const { state } = useAuth();
  const router = useRouter();
  const token = state.status === "signed-in" ? state.token : null;
  const handled = useRef<string | null>(null);

  const open = useCallback(
    async (response: Notifications.NotificationResponse) => {
      // One navigation per tapped notification, even if it is reported twice
      // (the listener and the cold-start lookup).
      const key = response.notification.request.identifier;
      if (handled.current === key) return;
      handled.current = key;
      const data = response.notification.request.content.data as Record<string, unknown> | null;
      const target = targetFor(data?.entity_type, data?.entity_id);
      if (!target) return;
      if (target.screen === "invoice") router.push({ pathname: "/invoice/[id]", params: { id: target.id } });
      else if (target.screen === "salaries") router.push("/(tabs)/salaries");
      else if (target.screen === "issue") {
        const issue = await getIssue(await getDb(), target.id).catch(() => null);
        const canvas = issue ? kindOf(issue) === "canvas" : false;
        router.push({ pathname: canvas ? "/canvas/[id]" : "/note/[id]", params: { id: target.id } });
      } else router.push("/");
      Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    },
    [router]
  );

  // Permission (asked once, explained) and registration on every start.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      await ensureChannel().catch(() => undefined);
      const perm = await Notifications.getPermissionsAsync();
      if (cancelled) return;
      if (perm.granted) {
        await registerDevice(token);
        return;
      }
      // Turned off in Android's settings since: stop pushing to this phone.
      if ((await SecureStore.getItemAsync(REGISTERED_KEY).catch(() => null)) === "1") {
        await apiRequest("/api/mobile/devices", { method: "DELETE", token }).catch(() => undefined);
        await SecureStore.deleteItemAsync(REGISTERED_KEY).catch(() => undefined);
      }
      const asked = await SecureStore.getItemAsync(ASKED_KEY).catch(() => null);
      if (asked || !perm.canAskAgain || cancelled) return;
      await SecureStore.setItemAsync(ASKED_KEY, "1").catch(() => undefined);
      Alert.alert(
        "Reminders on this phone",
        "book. can tell you when invoices, salaries and tasks are due. Google only carries a wake-up signal; the text comes from your server.",
        [
          { text: "Not now", style: "cancel" },
          {
            text: "Turn on",
            onPress: () =>
              void (async () => {
                if ((await Notifications.requestPermissionsAsync()).granted) await registerDevice(token);
              })(),
          },
        ]
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // FCM rotates tokens now and then: keep the server's copy current.
  useEffect(() => {
    if (!token) return;
    const sub = Notifications.addPushTokenListener((t) => {
      if (typeof t.data === "string") void registerDevice(token, t.data);
    });
    return () => sub.remove();
  }, [token]);

  // Taps: while running, and the one that launched the app.
  useEffect(() => {
    if (!token) return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void open(r));
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r) void open(r);
      })
      .catch(() => undefined);
    return () => sub.remove();
  }, [token, open]);

  return null;
}
