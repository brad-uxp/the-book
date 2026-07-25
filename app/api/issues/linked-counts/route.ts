import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api";

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

  const issues = await prisma.issue.findMany({
    where: { description: { not: "" } },
    select: { description: true },
  });

  const counts: Record<string, number> = {};
  const regex =
    type === "person"
      ? /data-mention-id="([^"]+)"/g
      : /data-invoice-id="([^"]+)"/g;

  for (const issue of issues) {
    const seen = new Set<string>();
    for (const match of issue.description.matchAll(regex)) {
      const id = match[1];
      if (!seen.has(id)) {
        seen.add(id);
        counts[id] = (counts[id] || 0) + 1;
      }
    }
  }

  return NextResponse.json(counts);
}
