import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { IssueSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get("personId");
  const invoiceId = searchParams.get("invoiceId");

  const where: Record<string, unknown> = {};

  if (personId) {
    where.description = { contains: `data-mention-id="${personId}"` };
  }
  if (invoiceId) {
    where.description = { contains: `data-invoice-id="${invoiceId}"` };
  }

  const issues = await prisma.issue.findMany({
    where,
    orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
    include: { client: true },
  });

  return NextResponse.json(issues);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = IssueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const clientId = parsed.data.client_id ?? null;

  const issue = await prisma.issue.create({
    data: {
      title: parsed.data.title,
      category: parsed.data.category ?? "task",
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
    after: {
      title: issue.title,
      client_id: issue.client_id,
      category: issue.category,
      status: issue.status,
      progress: issue.progress,
      due_date: issue.due_date,
    },
  });

  return NextResponse.json(issue, { status: 201 });
}
