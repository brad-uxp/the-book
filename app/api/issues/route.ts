import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { IssueCreateSchema } from "@/lib/validations";
import { getActorEmail } from "@/lib/audit";
import { requireSession, toApiResponse } from "@/lib/api";
import { mentionNeedle } from "@/lib/mentions";
import { createIssue, inTransaction } from "@/lib/issues-service";

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
  const parsed = IssueCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await inTransaction(await getActorEmail(), (tx, ctx) =>
      createIssue(tx, parsed.data, ctx)
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.value, { status: 201 });
  } catch (err) {
    // A client-chosen id that is taken is a P2002 → 409, never an overwrite.
    return toApiResponse(err);
  }
}
