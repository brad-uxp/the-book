import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isCanvasNote } from "@/lib/notes";

/**
 * The canvas note a nested canvas route acts on, or the response that says
 * why there is none: 404 when the issue does not exist, 409 when it exists
 * but is not a canvas — a task or a text note has no ideas to add to.
 *
 * Only the routes that *create* or *read* need it. Editing or deleting a node
 * or an edge is scoped by `issue_id` in its own where-clause, and a node can
 * only exist on a canvas: nothing converts a canvas back.
 */
export async function findCanvasNote(
  id: string
): Promise<{ id: string; title: string } | NextResponse> {
  const issue = await prisma.issue.findUnique({
    where: { id },
    select: { id: true, title: true, category: true, note_format: true },
  });
  if (!issue) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isCanvasNote(issue)) {
    return NextResponse.json(
      { error: "This issue is not a canvas note" },
      { status: 409 }
    );
  }
  return { id: issue.id, title: issue.title };
}

/** What a node looks like on the wire. Timestamps are not needed to draw it. */
export const NODE_SELECT = {
  id: true,
  content: true,
  color: true,
  x: true,
  y: true,
  width: true,
  height: true,
} as const;

export const EDGE_SELECT = {
  id: true,
  source_id: true,
  target_id: true,
} as const;
