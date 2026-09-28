import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CanvasEdgeSchema } from "@/lib/validations";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { findCanvasNote } from "@/lib/note-canvas-server";
import { createEdge } from "@/lib/canvas-service";

/**
 * A connection between two ideas of the same canvas.
 *
 * No check-then-insert — two quick drags of the same connection would both
 * pass it. The database answers instead, through toApiResponse:
 *
 *  - P2003 → 400: an end that is not an idea of THIS canvas. The compound
 *    foreign keys on (issue_id, node_id) make that impossible to store.
 *  - P2002 → 409: the connection, or the client-chosen id, already exists.
 *
 * Not audited, like the rest of what is drawn on a canvas.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const parsed = CanvasEdgeSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  const note = await findCanvasNote(id);
  if (note instanceof NextResponse) return note;

  try {
    const edge = await createEdge(prisma, { ...parsed.data, issue_id: id });
    return NextResponse.json(edge, { status: 201 });
  } catch (err) {
    return toApiResponse(err);
  }
}
