import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CanvasNodePatchSchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { plainTextSnippet } from "@/lib/mentions";
import { isBlankHtml } from "@/lib/notes";
import { EDGE_SELECT, NODE_SELECT } from "@/lib/note-canvas-server";

type Params = { params: Promise<{ id: string; nodeId: string }> };

/**
 * What an idea says, or its colour. Where it sits and how big it is go
 * through /canvas/layout, batched.
 *
 * Scoped by issue_id in the where-clause, so a node id from another canvas is
 * a 404 here rather than an edit to someone else's idea.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id, nodeId } = await params;

  const body = await readJson(req);
  const parsed = CanvasNodePatchSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  // Write only the keys that were sent: recolouring an idea must not blank
  // its text because `content` was absent — the same rule as the issue PATCH.
  const sent = new Set(
    body && typeof body === "object" ? Object.keys(body) : []
  );
  const data: { content?: string; color?: string | null } = {};
  if (sent.has("content")) data.content = parsed.data.content;
  if (sent.has("color")) data.color = parsed.data.color ?? null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const node = await prisma.canvasNode.update({
      where: { id: nodeId, issue_id: id },
      data,
      select: NODE_SELECT,
    });
    return NextResponse.json(node);
  } catch (err) {
    return toApiResponse(err);
  }
}

/**
 * Removes an idea and, by cascade, its connections.
 *
 * This is the write on a canvas that loses words, so it is the one that is
 * audited — with the content and the connections in `before`, which makes the
 * audit log the way back from a deletion nobody meant.
 *
 * An idea with no words is not audited, connections or not: the canvas
 * removes a card that was created and abandoned unwritten — including one
 * pulled out of another card's handle, which arrives already connected — and
 * a row for each of those would be noise on top of the history that matters.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id, nodeId } = await params;

  try {
    // Read first: after the delete the edges are gone with it, and a record
    // of a removed idea should say what it was connected to.
    const edges = await prisma.canvasEdge.findMany({
      where: {
        issue_id: id,
        OR: [{ source_id: nodeId }, { target_id: nodeId }],
      },
      select: EDGE_SELECT,
    });

    const node = await prisma.canvasNode.delete({
      where: { id: nodeId, issue_id: id },
      select: { ...NODE_SELECT, issue: { select: { title: true } } },
    });

    const { issue, ...removed } = node;
    if (isBlankHtml(removed.content)) {
      return NextResponse.json({ ok: true });
    }

    const snippet = plainTextSnippet(removed.content);
    auditLog({
      entity_type: "canvas_node",
      entity_id: nodeId,
      entity_name: snippet ? `${issue.title} › ${snippet}` : issue.title,
      action: "delete",
      actor_email: await getActorEmail(),
      before: { issue_id: id, ...removed, edges },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // P2025 becomes a 404, which is the right answer for "already gone".
    return toApiResponse(err);
  }
}
