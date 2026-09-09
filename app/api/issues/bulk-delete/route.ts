import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BulkDeleteIssuesSchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { ARCHIVED_WHERE } from "@/lib/issues";

/**
 * Empties the archive, in one request.
 *
 * A POST rather than a DELETE on the collection: a request body on DELETE is
 * legal but widely mangled by proxies, and this is the one endpoint where a
 * silently truncated list would delete the wrong rows. It follows the shape
 * already used by /api/notifications/mark-all-read.
 *
 * **Scoped to archived issues, deliberately.** The where-clause repeats
 * ARCHIVED_WHERE on top of the ids, so this path can only ever remove work
 * that was already put away. A bug in the selection UI — an id list built from
 * the wrong array, a stale filter — cannot reach an active issue through here.
 * Ids that are not archived are reported back as skipped rather than deleted.
 *
 * Deletion is permanent: Issue has no deleted_at. The confirmation lives in
 * the UI; this is the last stop.
 */
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const parsed = BulkDeleteIssuesSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  const ids = [...new Set(parsed.data.ids)];

  try {
    // Read first: after the delete the titles are gone, and an audit entry
    // that cannot say what it removed is not much of a record.
    const doomed = await prisma.issue.findMany({
      where: { id: { in: ids }, ...ARCHIVED_WHERE },
      select: { id: true, title: true, client_id: true, due_date: true },
    });

    if (doomed.length === 0) {
      return NextResponse.json({ deleted: 0, skipped: ids.length });
    }

    const { count } = await prisma.issue.deleteMany({
      where: { id: { in: doomed.map((d) => d.id) }, ...ARCHIVED_WHERE },
    });

    const actor = await getActorEmail();
    for (const issue of doomed) {
      auditLog({
        entity_type: "issue",
        entity_id: issue.id,
        entity_name: issue.title,
        action: "delete",
        actor_email: actor,
        before: {
          title: issue.title,
          client_id: issue.client_id,
          category: "task",
          status: "done",
          due_date: issue.due_date,
        },
      });
    }

    return NextResponse.json({ deleted: count, skipped: ids.length - count });
  } catch (err) {
    return toApiResponse(err);
  }
}
