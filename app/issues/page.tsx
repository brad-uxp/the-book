import { prisma } from "@/lib/db";
import { IssuesView } from "@/components/issues/issues-view";

export const dynamic = "force-dynamic";

export default async function IssuesPage() {
  const [clients, issues, links, labels] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.issue.findMany({
      orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
      include: { client: true },
    }),
    // Edges for the canvas view. One extra findMany on a table that holds a
    // row per drawn connection — cheaper than a fetch once the view mounts,
    // and it keeps the canvas from flashing in empty.
    prisma.issueLink.findMany({
      orderBy: { created_at: "asc" },
      select: { id: true, source_id: true, target_id: true, label: true },
    }),
    prisma.canvasLabel.findMany({
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        text: true,
        color: true,
        canvas_x: true,
        canvas_y: true,
      },
    }),
  ]);

  const serializedIssues = issues.map((t) => ({
    ...t,
    due_date: t.due_date?.toISOString() ?? null,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Issues</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage and track project issues.
        </p>
      </div>

      <IssuesView
        clients={clients}
        initialIssues={serializedIssues}
        initialLinks={links}
        initialLabels={labels}
      />
    </div>
  );
}
