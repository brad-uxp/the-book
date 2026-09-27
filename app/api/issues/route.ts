import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { IssueSchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession } from "@/lib/api";
import { mentionNeedle } from "@/lib/mentions";
import { checkShapeChange } from "@/lib/notes";

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get("personId");
  const invoiceId = searchParams.get("invoiceId");

  // An invoice filter wins over a person filter, as it always has.
  const needle = invoiceId
    ? mentionNeedle("invoice", invoiceId)
    : personId
      ? mentionNeedle("person", personId)
      : null;

  // A mention can live in the description or in any idea of a canvas note.
  const where = needle
    ? {
        OR: [
          { description: { contains: needle } },
          { canvas_nodes: { some: { content: { contains: needle } } } },
        ],
      }
    : {};

  const issues = await prisma.issue.findMany({
    where,
    orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
    include: { client: true },
  });

  return NextResponse.json(issues);
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await req.json();
  const parsed = IssueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const shape = checkShapeChange(null, {
    category: parsed.data.category,
    note_format: parsed.data.note_format,
  });
  if (!shape.ok) {
    return NextResponse.json({ error: shape.error }, { status: shape.status });
  }

  const clientId = parsed.data.client_id ?? null;

  const issue = await prisma.issue.create({
    data: {
      title: parsed.data.title,
      category: parsed.data.category ?? "task",
      note_format: parsed.data.note_format,
      status: parsed.data.status ?? "pending",
      progress: parsed.data.progress ?? 0,
      due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null,
      description: parsed.data.description ?? "",
      sort_order: parsed.data.sort_order ?? 0,
      ...(clientId ? { client: { connect: { id: clientId } } } : {}),
    },
    include: { client: true },
  });

  auditLog({
    entity_type: "issue",
    entity_id: issue.id,
    entity_name: issue.title,
    action: "create",
    actor_email: await getActorEmail(),
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

  return NextResponse.json(issue, { status: 201 });
}
