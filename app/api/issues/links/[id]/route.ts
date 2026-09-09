import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession, toApiResponse } from "@/lib/api";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  try {
    // Read before deleting so the audit entry says which two issues were
    // wired together; after the DELETE the titles are unreachable.
    const before = await prisma.issueLink.findUnique({
      where: { id },
      include: {
        source: { select: { title: true } },
        target: { select: { title: true } },
      },
    });
    if (!before) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.issueLink.delete({ where: { id } });

    auditLog({
      entity_type: "issue_link",
      entity_id: id,
      entity_name: `${before.source.title} → ${before.target.title}`,
      action: "delete",
      actor_email: await getActorEmail(),
      before: {
        source_id: before.source_id,
        target_id: before.target_id,
        label: before.label,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toApiResponse(err);
  }
}
