import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalid, readJson, requireSession, toApiResponse } from "@/lib/api";
import { CanvasEdgeUpdateSchema } from "@/lib/validations";
import { SelfLinkError, deleteEdge, updateEdge } from "@/lib/canvas-service";

/**
 * Moves a connection: to another idea at either end, or to a chosen side of
 * a card (null gives the side back to the canvas). Like creating one, not
 * audited — it is drawing.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; edgeId: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id, edgeId } = await params;

  const parsed = CanvasEdgeUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const edge = await updateEdge(prisma, id, edgeId, parsed.data);
    return NextResponse.json(edge);
  } catch (err) {
    if (err instanceof SelfLinkError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // P2025 → 404 (not this canvas's), P2002 → 409 (would duplicate another
    // connection), P2003 → 400 (an end that is not an idea of this canvas).
    return toApiResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; edgeId: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id, edgeId } = await params;

  try {
    // Scoped by issue_id: an edge of another canvas is a 404 from here.
    await deleteEdge(prisma, id, edgeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // P2025 becomes a 404, which is the right answer for "already gone".
    return toApiResponse(err);
  }
}
