import { NextRequest, NextResponse } from "next/server";
import { getActorEmail } from "@/lib/audit";
import { requireUserSession } from "@/lib/api";
import { revokeConnection } from "@/lib/oauth-service";

export const runtime = "nodejs";

/**
 * Disconnects an app: the connection and every token it issued are revoked,
 * so its next call to the MCP is a 401. Like a token, revoked, not deleted.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireUserSession();
  if (denied) return denied;
  const { id } = await params;
  const revoked = await revokeConnection(id, await getActorEmail());
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
