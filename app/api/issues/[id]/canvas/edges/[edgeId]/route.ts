import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, toApiResponse } from "@/lib/api";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; edgeId: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id, edgeId } = await params;

  try {
    // Scoped by issue_id: an edge of another canvas is a 404 from here.
    await prisma.canvasEdge.delete({ where: { id: edgeId, issue_id: id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // P2025 becomes a 404, which is the right answer for "already gone".
    return toApiResponse(err);
  }
}
