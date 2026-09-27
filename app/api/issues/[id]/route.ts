import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { IssueSchema } from "@/lib/validations";
import { getActorEmail } from "@/lib/audit";
import { requireSession, toApiResponse } from "@/lib/api";
import {
  deleteIssue,
  inTransaction,
  pickSent,
  updateIssue,
} from "@/lib/issues-service";

/**
 * One issue, in the same shape the list returns. Documented in API.md long
 * before it existed — a machine client following the docs got a 405.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const issue = await prisma.issue.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(issue);
}

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

  // Only the keys the client sent change — see pickSent. Which moves between
  // task, note and canvas exist is lib/notes.ts, applied by the service.
  const patch = pickSent(body, parsed.data);

  try {
    const result = await inTransaction(await getActorEmail(), (tx, ctx) =>
      updateIssue(tx, id, patch, ctx)
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.value);
  } catch (err) {
    return toApiResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  try {
    const result = await inTransaction(await getActorEmail(), (tx, ctx) =>
      deleteIssue(tx, id, ctx)
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiResponse(err);
  }
}
