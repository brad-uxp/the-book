import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, toApiResponse } from "@/lib/api";

export const runtime = "nodejs";

/**
 * One notification of the in-app centre. The phone calls it when a push says
 * "notification <id>": the push carries only the id, the title and body come
 * from here, over the phone's own token.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  if (id.length > 64) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        entity_type: true,
        entity_id: true,
        event_date: true,
        created_at: true,
        read_at: true,
      },
    });
    if (!notification) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(notification);
  } catch (err) {
    return toApiResponse(err);
  }
}
