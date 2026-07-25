import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const clients = await prisma.client.findMany({
    where: { default_referrer_id: id },
    select: { id: true, name: true, color_hex: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(clients);
}
