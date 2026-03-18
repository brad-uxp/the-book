import { sendWebPushToAll } from "@/lib/web-push";

interface NotifyParams {
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
}

/**
 * Sends a web push notification for a given notification.
 * Designed to be fail-safe: errors are logged but never thrown.
 */
export async function notify(params: NotifyParams) {
  try {
    await sendWebPushToAll({
      title: params.title,
      body: params.body,
      data: {
        entity_type: params.entity_type,
        entity_id: params.entity_id,
        url: `/${params.entity_type}s`,
      },
    });
  } catch (err) {
    console.error("[notify] web push failed:", err);
  }
}
