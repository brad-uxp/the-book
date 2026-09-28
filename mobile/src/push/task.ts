import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { API_URL } from "../lib/config";
import { TOKEN_KEY } from "../lib/session";
import { readPushPayload, shouldShowInForeground, TEST_NOTIFICATION, type PushPayload } from "./payload";

/**
 * Receiving a push. Loaded first by index.ts, before the router: when a push
 * arrives with the app closed, Android starts the JS bundle headless — no
 * screens, no React tree — and only what module scope set up runs. So the
 * task is defined and registered here, at import time.
 *
 * The push is data-only ({ kind, id }). The task fetches the notification
 * from book.'s API with the phone's own token and shows it as a local
 * notification. It runs in every app state: foreground, background and
 * killed (expo-notifications calls the task for every FCM message).
 */

export const PUSH_TASK = "book-push";
export const CHANNEL_ID = "reminders";

/** Android shows nothing on a channel that does not exist yet. Idempotent. */
export async function ensureChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Reminders",
    description: "Invoices, salaries and tasks that are due",
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: "#8B5CF6",
    // A reminder can carry an amount: on a locked screen Android shows only
    // "book." and hides the text until the phone is unlocked. A channel's
    // settings are fixed once created, so this has to ship in its first build.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

async function present(title: string, body: string, data: Record<string, string>): Promise<void> {
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: { channelId: CHANNEL_ID },
  });
}

/** Turns a push into the notification the owner sees. Never throws. */
export async function handlePush(payload: PushPayload): Promise<boolean> {
  if (payload.kind === "test") {
    await present(TEST_NOTIFICATION.title, TEST_NOTIFICATION.body, { kind: "test" });
    return true;
  }
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (!token) return false; // Signed out since: nothing to show, nothing to ask.
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/notifications/${encodeURIComponent(payload.id)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  } catch {
    return false; // Offline: the web's notification centre still has it.
  }
  if (!res.ok) return false;
  const n = (await res.json().catch(() => null)) as {
    id?: unknown;
    title?: unknown;
    body?: unknown;
    entity_type?: unknown;
    entity_id?: unknown;
  } | null;
  if (!n || typeof n.title !== "string" || typeof n.body !== "string") return false;
  await present(n.title, n.body, {
    kind: "notification",
    id: payload.id,
    entity_type: typeof n.entity_type === "string" ? n.entity_type : "",
    entity_id: typeof n.entity_id === "string" ? n.entity_id : "",
  });
  return true;
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
  if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
  // A tap on one of our notifications also reaches here on Android; it is
  // handled by the response listener in PushManager, not as a push.
  if (data && typeof data === "object" && "actionIdentifier" in data) {
    return Notifications.BackgroundNotificationTaskResult.NoData;
  }
  const payload = readPushPayload(data);
  if (!payload) return Notifications.BackgroundNotificationTaskResult.NoData;
  try {
    return (await handlePush(payload))
      ? Notifications.BackgroundNotificationTaskResult.NewData
      : Notifications.BackgroundNotificationTaskResult.NoData;
  } catch {
    return Notifications.BackgroundNotificationTaskResult.Failed;
  }
});

// In the foreground the data-only push also reaches this handler. It has no
// title, and showing it would draw an empty notification: only the ones the
// task builds (with a title) are shown.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = shouldShowInForeground(notification.request.content);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

Notifications.registerTaskAsync(PUSH_TASK).catch((err: unknown) =>
  console.warn("[push] registerTaskAsync", err instanceof Error ? err.message : err)
);
