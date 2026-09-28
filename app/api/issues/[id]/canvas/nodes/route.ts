import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CanvasNodeSchema } from "@/lib/validations";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { findCanvasNote } from "@/lib/note-canvas-server";
import { createNode } from "@/lib/canvas-service";

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
    const node = await createNode(prisma, { ...parsed.data, issue_id: id });
    return NextResponse.json(node, { status: 201 });
  } catch (err) {
    return toApiResponse(err);
  }
}
