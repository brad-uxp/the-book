import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { IssueLinkSchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";

/**
 * Edges between issues, drawn on the canvas view.
 *
 * Not the same thing as the "linked issues" shown on a person or an invoice:
 * those are @mentions parsed out of description HTML (see
 * /api/issues/linked-counts). These are real rows.
 *
 * Unlike positions, edges ARE audited — an edge is a statement about the work
 * ("this blocks that"), and losing one silently should be answerable.
 */

const WITH_TITLES = {
  source: { select: { title: true } },
  target: { select: { title: true } },
} as const;

/** Label for the audit log: readable months later, without a JOIN. */
function edgeName(sourceTitle: string, targetTitle: string): string {
  return `${sourceTitle} → ${targetTitle}`;
}

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const links = await prisma.issueLink.findMany({
    orderBy: { created_at: "asc" },
  });
  return NextResponse.json(links);
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const parsed = IssueLinkSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  try {
    // A missing issue surfaces as P2003 → 400, and a duplicate edge as
    // P2002 → 409, both from toApiResponse. No check-then-insert: two quick
    // drags of the same connection would each pass it.
    const link = await prisma.issueLink.create({
      data: {
        source_id: parsed.data.source_id,
        target_id: parsed.data.target_id,
        label: parsed.data.label ?? null,
      },
      include: WITH_TITLES,
    });

    auditLog({
      entity_type: "issue_link",
      entity_id: link.id,
      entity_name: edgeName(link.source.title, link.target.title),
      action: "create",
      actor_email: await getActorEmail(),
      after: {
        source_id: link.source_id,
        target_id: link.target_id,
        label: link.label,
      },
    });

    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    return toApiResponse(err);
  }
}
