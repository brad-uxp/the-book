import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { IssueSchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession, toApiResponse } from "@/lib/api";
import { checkShapeChange, isBlankHtml } from "@/lib/notes";
import { SEED_NODE_HEIGHT, SEED_NODE_WIDTH } from "@/lib/note-canvas";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json();

  const parsed = IssueSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Use raw body keys to decide which fields to update — Zod .default()
  // fills in values even with .partial(), which would overwrite fields the
  // client never sent (e.g. status → "pending" on every description edit).
  const sent = new Set(Object.keys(body));
  const data: Record<string, unknown> = {};
  if (sent.has("title")) data.title = parsed.data.title;
  if (sent.has("client_id")) {
    const cid = parsed.data.client_id;
    data.client = cid ? { connect: { id: cid } } : { disconnect: true };
  }
  if (sent.has("category")) data.category = parsed.data.category;
  if (sent.has("note_format")) data.note_format = parsed.data.note_format;
  if (sent.has("status")) data.status = parsed.data.status;
  if (sent.has("progress")) data.progress = parsed.data.progress;
  if (sent.has("due_date"))
    data.due_date = parsed.data.due_date ? new Date(parsed.data.due_date) : null;
  if (sent.has("description")) data.description = parsed.data.description;
  if (sent.has("sort_order")) data.sort_order = parsed.data.sort_order;

  const before = await prisma.issue.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Turning into a task, a note or a canvas: see lib/notes.ts for which moves
  // exist. Checked against the row as stored, since the client may send only
  // one half of the shape.
  const shape = checkShapeChange(before, {
    category: sent.has("category") ? parsed.data.category! : before.category,
    note_format: sent.has("note_format")
      ? parsed.data.note_format!
      : before.note_format,
  });
  if (!shape.ok) {
    return NextResponse.json({ error: shape.error }, { status: shape.status });
  }

  // A text note becoming a canvas: what it said becomes its first idea, in the
  // same transaction, so there is no moment where the words are in neither
  // place. The description is emptied — a canvas does not show one, and a
  // stale copy would keep answering "linked issues" for mentions the user has
  // since removed from the idea.
  let seed: string | null = null;
  if (shape.seedFromDescription) {
    const description = sent.has("description")
      ? (parsed.data.description ?? "")
      : before.description;
    if (!isBlankHtml(description)) seed = description;
    data.description = "";
  }

  let issue;
  try {
    issue = await prisma.$transaction(async (tx) => {
      const updated = await tx.issue.update({
        where: { id },
        data,
        include: { client: true },
      });
      if (seed !== null) {
        await tx.canvasNode.create({
          data: {
            issue_id: id,
            content: seed,
            x: 0,
            y: 0,
            width: SEED_NODE_WIDTH,
            height: SEED_NODE_HEIGHT,
          },
        });
      }
      return updated;
    });
  } catch (err) {
    return toApiResponse(err);
  }

  auditLog({
    entity_type: "issue",
    entity_id: id,
    entity_name: issue.title,
    action: "update",
    actor_email: await getActorEmail(),
    before: before ? {
      title: before.title,
      client_id: before.client_id,
      category: before.category,
      note_format: before.note_format,
      status: before.status,
      progress: before.progress,
      due_date: before.due_date,
    } : null,
    after: {
      title: issue.title,
      client_id: issue.client_id,
      category: issue.category,
      note_format: issue.note_format,
      status: issue.status,
      progress: issue.progress,
      due_date: issue.due_date,
    },
  });

  return NextResponse.json(issue);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const before = await prisma.issue.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.issue.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "issue",
      entity_id: id,
      entity_name: before.title,
      action: "delete",
      actor_email: await getActorEmail(),
      before: {
        title: before.title,
        client_id: before.client_id,
        category: before.category,
        note_format: before.note_format,
        status: before.status,
        progress: before.progress,
        due_date: before.due_date,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
