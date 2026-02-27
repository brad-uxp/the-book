import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const clients = await prisma.client.findMany({
    where: { default_referrer_id: id },
    select: { id: true, name: true, color_hex: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(clients);
}
