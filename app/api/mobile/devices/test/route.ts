import { NextResponse } from "next/server";
import { invalid, readJsonLimited } from "@/lib/api";
import { requireMobileToken } from "@/lib/mobile-session";
import { MOBILE_BODY_MAX_BYTES } from "@/lib/mobile-auth";
import { pushToToken } from "@/lib/push";
import { MobileDeviceTestSchema } from "@/lib/validations";

export const runtime = "nodejs";

/**
 * "Send test notification" in the app: a push to the calling phone only, so
 * the owner can check delivery end to end in production. With delay_seconds
 * (≤ 60) it goes out later — time to close the app or lock the phone and see
 * a push arrive with the app in the background or not running at all.
 *
 * The delayed send is a timer in this process: fine for one replica and a
 * test button; a restart in between just drops that one test.
 */
export async function POST(req: Request) {
  const auth = await requireMobileToken();
  if ("denied" in auth) return auth.denied;

  const body = await readJsonLimited(req, MOBILE_BODY_MAX_BYTES);
  const raw = body.ok ? body.value : body.reason === "invalid" ? {} : null;
  if (raw === null) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  const parsed = MobileDeviceTestSchema.safeParse(raw ?? {});
  if (!parsed.success) return invalid(parsed.error);

  const delay = parsed.data.delay_seconds ?? 0;
  if (delay > 0) {
    const timer = setTimeout(() => {
      pushToToken(auth.tokenId, { kind: "test" }).catch((err) =>
        console.error("[push] delayed test:", err instanceof Error ? err.message : err)
      );
    }, delay * 1000);
    timer.unref?.();
    return NextResponse.json({ status: "scheduled", delay_seconds: delay }, { status: 202 });
  }

  const outcome = await pushToToken(auth.tokenId, { kind: "test" });
  if (outcome === "no_device") {
    return NextResponse.json({ status: "no_device" }, { status: 409 });
  }
  if (outcome.off) return NextResponse.json({ status: "not_configured" }, { status: 503 });
  if (outcome.sent === 1) return NextResponse.json({ status: "sent" });
  if (outcome.removed === 1) return NextResponse.json({ status: "unregistered" }, { status: 410 });
  return NextResponse.json({ status: "failed" }, { status: 502 });
}
