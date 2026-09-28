import { NextResponse } from "next/server";
import { requireSession, resolveActor } from "@/lib/api";

/**
 * Authorization for routes that belong to the phone's own sign-in — its push
 * device: only an API token the app's sign-in minted (kind `mobile`). Not the
 * browser, which has no device, and not a hand-made automation token, which
 * must not be able to aim the owner's notifications at another phone.
 *
 * Returns the token's id, or a response to hand straight back.
 */
export async function requireMobileToken(): Promise<{ tokenId: string } | { denied: NextResponse }> {
  const denied = await requireSession();
  if (denied) return { denied };
  const actor = await resolveActor();
  if (actor?.kind !== "token" || actor.tokenKind !== "mobile") {
    return {
      denied: NextResponse.json({ error: "Only the book. app's sign-in can manage its device" }, { status: 403 }),
    };
  }
  return { tokenId: actor.id };
}
