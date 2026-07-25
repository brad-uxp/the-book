import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireUserSession, toApiResponse } from "@/lib/api";

export const runtime = "nodejs";

/**
 * Revokes a token. Soft, not a delete: the audit log references it, and "this
 * token was revoked on that date" is exactly the sort of thing you want to
 * still be able to read afterwards.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireUserSession();
  if (denied) return denied;
  const { id } = await params;

  const before = await prisma.apiToken.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (before.revoked_at) {
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }

  try {
    await prisma.apiToken.update({
      where: { id },
      data: { revoked_at: new Date() },
    });

    auditLog({
      entity_type: "api_token",
      entity_id: id,
      entity_name: before.name,
      action: "delete",
      actor_email: await getActorEmail(),
      before: {
        name: before.name,
        token_prefix: before.token_prefix,
        last_used_at: before.last_used_at,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiResponse(err);
  }
}
