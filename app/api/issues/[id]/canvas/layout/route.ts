import { NextRequest, NextResponse } from "next/server";
import { CanvasLayoutSchema } from "@/lib/validations";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { updateLayout } from "@/lib/canvas-service";

/**
 * Where the ideas on one canvas sit, and how big they are.
 *
 * Batched: dragging a selection or resizing a card is one gesture and has to
 * be one request. NOT audited — it is view state, and a row per drag would
 * bury the history that matters under coordinates.
 *
 * updateMany scoped by issue_id: an id that is gone (deleted in another tab
 * mid-drag) or that belongs to another canvas is a no-op, not a failure that
 * throws away the rest of the gesture.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const parsed = CanvasLayoutSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const updated = await updateLayout(id, parsed.data.nodes);
    return NextResponse.json({ updated });
  } catch (err) {
    return toApiResponse(err);
  }
}
