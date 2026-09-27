import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api";
import { MENTION_ATTR, countMentions } from "@/lib/mentions";

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type"); // "person" | "invoice"

  if (!type || (type !== "person" && type !== "invoice")) {
    return NextResponse.json(
      { error: "type must be 'person' or 'invoice'" },
      { status: 400 }
    );
  }

  // Mentions live in descriptions and, on canvas notes, in each idea. Only
  // rows that hold at least one mention of this kind are read.
  const marker = `${MENTION_ATTR[type]}="`;
  const [issues, nodes] = await Promise.all([
    prisma.issue.findMany({
      where: { description: { contains: marker } },
      select: { id: true, description: true },
    }),
    prisma.canvasNode.findMany({
      where: { content: { contains: marker } },
      select: { issue_id: true, content: true },
    }),
  ]);

  const counts = countMentions(
    [
      ...issues.map((i) => ({ issue_id: i.id, html: i.description })),
      ...nodes.map((n) => ({ issue_id: n.issue_id, html: n.content })),
    ],
    type
  );

  return NextResponse.json(counts);
}
