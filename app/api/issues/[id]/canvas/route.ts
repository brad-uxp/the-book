import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api";
import {
  EDGE_SELECT,
  NODE_SELECT,
  findCanvasNote,
} from "@/lib/note-canvas-server";

/**
 * Everything drawn on a canvas note: its ideas and the connections between
 * them. The note's own fields (title, client) come from /api/issues.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const note = await findCanvasNote(id);
  if (note instanceof NextResponse) return note;

  const [nodes, edges] = await Promise.all([
    prisma.canvasNode.findMany({
      where: { issue_id: id },
      orderBy: { created_at: "asc" },
      select: NODE_SELECT,
    }),
    prisma.canvasEdge.findMany({
      where: { issue_id: id },
      orderBy: { created_at: "asc" },
      select: EDGE_SELECT,
    }),
  ]);

  return NextResponse.json({ nodes, edges });
}
