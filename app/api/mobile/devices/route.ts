import { NextResponse } from "next/server";
import { invalid, readJsonLimited, toApiResponse } from "@/lib/api";
import { requireMobileToken } from "@/lib/mobile-session";
import { MOBILE_BODY_MAX_BYTES } from "@/lib/mobile-auth";
import { forgetDevice, registerDevice } from "@/lib/push";
import { MobileDeviceSchema } from "@/lib/validations";

export const runtime = "nodejs";

/**
 * The phone registers (or refreshes) its native FCM token, so the server can
 * push to it. Called after sign-in once notifications are allowed, on every
 * start, and when FCM rotates the token. One device per sign-in token.
 */
export async function POST(req: Request) {
  const auth = await requireMobileToken();
  if ("denied" in auth) return auth.denied;

  const body = await readJsonLimited(req, MOBILE_BODY_MAX_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Request too large" : "Invalid JSON" },
      { status: body.reason === "too_large" ? 413 : 400 }
    );
  }
  const parsed = MobileDeviceSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await registerDevice({
      apiTokenId: auth.tokenId,
      fcmToken: parsed.data.fcm_token,
      platform: parsed.data.platform,
      appVersion: parsed.data.app_version ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiResponse(err);
  }
}

/** The phone stops receiving pushes (notifications turned off in the app). */
export async function DELETE() {
  const auth = await requireMobileToken();
  if ("denied" in auth) return auth.denied;
  try {
    await forgetDevice(auth.tokenId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiResponse(err);
  }
}
