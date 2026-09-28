import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { isCanvasNote } from "@/lib/notes";
import { EDGE_SELECT, NODE_SELECT, toConnection } from "@/lib/note-canvas-server";
import { NoteCanvasView } from "@/components/note-canvas/note-canvas-view";

export const dynamic = "force-dynamic";

/**
 * An issue's own page. Only a canvas note has one — a canvas does not fit in
 * the detail sheet. Anything else is sent to the list with its sheet open, so
 * /issues/<id> is a link that works for every issue.
 */
export default async function IssuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const issue = await prisma.issue.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!issue) notFound();
  if (!isCanvasNote(issue)) redirect(`/issues?issue=${id}`);

  const [clients, ideas, connections] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.canvasNode.findMany({
      where: { issue_id: id },
      orderBy: { created_at: "asc" },
      select: NODE_SELECT,
    }),
    prisma.canvasEdge.findMany({
      where: { issue_id: id },
      orderBy: { created_at: "asc" },
      select: EDGE_SELECT,
    }),
  ]);

  return (
    <NoteCanvasView
      // Only what the header shows and edits; the rest of the row stays here.
      issue={{
        id: issue.id,
        title: issue.title,
        client_id: issue.client_id,
        client: issue.client,
        category: issue.category,
        note_format: issue.note_format,
        status: issue.status,
        progress: issue.progress,
        due_date: issue.due_date?.toISOString() ?? null,
        description: issue.description,
      }}
      clients={clients}
      ideas={ideas}
      connections={connections.map(toConnection)}
    />
  );
}
