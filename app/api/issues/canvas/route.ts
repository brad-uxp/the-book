import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CanvasPositionsSchema } from "@/lib/validations";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";

/**
 * Persists where cards sit on the canvas.
 *
 * Batched on purpose: dragging a selection of cards is one gesture and has to
 * be one request. It is also why this is a route of its own rather than a
 * field on PATCH /api/issues/[id].
 *
 * Deliberately NOT audited. Moving a card is not a change to the issue — it is
 * view state — and one audit row per drag would bury the history that matters
 * (title, status, client, due date) under thousands of coordinate entries.
 *
 * Uses updateMany rather than update so an id that no longer exists is a no-op
 * instead of a P2025 that fails the whole batch: the realistic case is a card
 * deleted in another tab while this one was dragging.
 */
export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const parsed = CanvasPositionsSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  // Last write wins for a repeated id, so the batch holds one update per card.
  const byId = new Map(parsed.data.nodes.map((n) => [n.id, n]));

  try {
    const results = await prisma.$transaction(
      [...byId.values()].map((n) =>
        prisma.issue.updateMany({
          where: { id: n.id },
          data: { canvas_x: n.x, canvas_y: n.y },
        })
      )
    );

    const updated = results.reduce((sum, r) => sum + r.count, 0);
    return NextResponse.json({ updated });
  } catch (err) {
    return toApiResponse(err);
  }
}
