import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { requireSession, resolveActor, toApiResponse } from "@/lib/api";

export const runtime = "nodejs";

/**
 * The app signing out: the calling token revokes ITSELF, and nothing else.
 *
 * Takes no id on purpose. A token can end its own life but never another
 * token's, and it can never mint one — managing tokens stays behind an
 * interactive session in /api/settings/tokens.
 */
export async function POST() {
  const denied = await requireSession();
  if (denied) return denied;

  const actor = await resolveActor();
  if (!actor || actor.kind !== "token") {
    return NextResponse.json(
      { error: "Only an API token can sign itself out" },
      { status: 400 }
    );
  }

  try {
    const revoked = await prisma.apiToken.updateMany({
      where: { id: actor.id, revoked_at: null },
      data: { revoked_at: new Date() },
    });

    if (revoked.count > 0) {
      auditLog({
        entity_type: "api_token",
        entity_id: actor.id,
        entity_name: actor.label.replace(/^token:/, ""),
        action: "delete",
        actor_email: actor.label,
        before: { revoked_by: "itself (mobile sign-out)" },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiResponse(err);
  }
}
