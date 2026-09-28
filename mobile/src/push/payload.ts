/**
 * What a push means, decided without any native module (tested with
 * `pnpm test`). The native side lives in ./task.ts and ./PushProvider.tsx.
 *
 * The server sends data-only FCM messages: `{ kind: "notification", id }` for
 * a row of the notification centre, `{ kind: "test" }` for the owner's test
 * button. Never a title or body — the app fetches those from book.'s API with
 * its own token and shows the notification itself.
 */

export type PushPayload = { kind: "notification"; id: string } | { kind: "test" };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function fromRecord(r: unknown): PushPayload | null {
  if (!r || typeof r !== "object") return null;
  const v = r as Record<string, unknown>;
  if (v.kind === "test") return { kind: "test" };
  if (v.kind === "notification" && typeof v.id === "string" && ID.test(v.id)) {
    return { kind: "notification", id: v.id };
  }
  return null;
}

/**
 * Reads the payload out of what expo-notifications hands the background task
 * on Android: the serialized RemoteMessage, whose `data` holds FCM's data map
 * (plus a `dataString` that is only set when the map has a `body` key). Also
 * accepts the map itself or a JSON `dataString`, so a change in how the
 * library nests it does not silently drop pushes. Anything else: null.
 */
export function readPushPayload(taskData: unknown): PushPayload | null {
  if (!taskData || typeof taskData !== "object") return null;
  const outer = taskData as Record<string, unknown>;
  const inner = outer.data;
  const direct = fromRecord(inner) ?? fromRecord(outer);
  if (direct) return direct;
  const dataString =
    inner && typeof inner === "object" ? (inner as Record<string, unknown>).dataString : outer.dataString;
  if (typeof dataString === "string") {
    try {
      return fromRecord(JSON.parse(dataString));
    } catch {
      return null;
    }
  }
  return null;
}

/** Where tapping a notification takes you. */
export type PushTarget =
  | { screen: "invoice"; id: string }
  | { screen: "issue"; id: string }
  | { screen: "salaries" }
  | { screen: "home" };

/**
 * From the notification's entity (as the daily job writes it) to a screen.
 * Subscriptions have no screen on the phone: the app just opens.
 */
export function targetFor(entityType: unknown, entityId: unknown): PushTarget | null {
  const id = typeof entityId === "string" && ID.test(entityId) ? entityId : null;
  switch (entityType) {
    case "invoice":
      return id ? { screen: "invoice", id } : { screen: "home" };
    case "issue":
      return id ? { screen: "issue", id } : { screen: "home" };
    case "person":
    case "salary_increase_reminder":
      return { screen: "salaries" };
    case "subscription":
      return { screen: "home" };
    default:
      return null;
  }
}

/** The local notification the test push shows. */
export const TEST_NOTIFICATION = {
  title: "book. notifications work",
  body: "This test came from your server. Reminders about invoices, salaries and tasks arrive the same way.",
} as const;

/**
 * Whether the foreground handler should show a notification. Only the ones the
 * app builds itself (they have a title): the data-only push that triggered
 * them has none, and showing it would draw an empty notification.
 */
export function shouldShowInForeground(content: { title?: string | null; body?: string | null }): boolean {
  return Boolean(content.title && content.title.trim());
}
