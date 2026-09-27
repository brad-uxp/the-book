import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CanvasNodeSchema } from "@/lib/validations";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { NODE_SELECT, findCanvasNote } from "@/lib/note-canvas-server";

/**
 * A new idea on a canvas note.
 *
 * The id may come from the client — see CanvasNodeSchema. A duplicate is a
 * 409 from the primary key, never an overwrite of someone else's node.
 *
 * Not audited: an idea is written and rewritten constantly, and a row per
 * creation would bury the history that matters. Deleting one is audited, with
 * its content, because that is the write that loses words.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const parsed = CanvasNodeSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  const note = await findCanvasNote(id);
  if (note instanceof NextResponse) return note;

  try {
    const node = await prisma.canvasNode.create({
      data: {
        ...(parsed.data.id ? { id: parsed.data.id } : {}),
        issue_id: id,
        x: parsed.data.x,
        y: parsed.data.y,
        ...(parsed.data.width !== undefined ? { width: parsed.data.width } : {}),
        ...(parsed.data.height !== undefined ? { height: parsed.data.height } : {}),
        content: parsed.data.content,
        color: parsed.data.color ?? null,
      },
      select: NODE_SELECT,
    });
    return NextResponse.json(node, { status: 201 });
  } catch (err) {
    return toApiResponse(err);
  }
}
