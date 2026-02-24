import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { IssueSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  if (sent.has("status")) data.status = parsed.data.status;
  if (sent.has("progress")) data.progress = parsed.data.progress;
  if (sent.has("due_date"))
    data.due_date = parsed.data.due_date ? new Date(parsed.data.due_date) : null;
  if (sent.has("description")) data.description = parsed.data.description;
  if (sent.has("sort_order")) data.sort_order = parsed.data.sort_order;

  const before = await prisma.issue.findUnique({ where: { id } });

  const issue = await prisma.issue.update({
    where: { id },
    data,
    include: { client: true },
  });

  auditLog({
    entity_type: "issue",
    entity_id: id,
    entity_name: issue.title,
    action: "update",
    before: before ? {
      title: before.title,
      client_id: before.client_id,
      category: before.category,
      status: before.status,
      progress: before.progress,
      due_date: before.due_date,
    } : null,
    after: {
      title: issue.title,
      client_id: issue.client_id,
      category: issue.category,
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
  const { id } = await params;

  const before = await prisma.issue.findUnique({ where: { id } });

  await prisma.issue.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "issue",
      entity_id: id,
      entity_name: before.title,
      action: "delete",
      before: {
        title: before.title,
        client_id: before.client_id,
        category: before.category,
        status: before.status,
        progress: before.progress,
        due_date: before.due_date,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
