import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const unreadCount = await prisma.notification.count({
    where: { read_at: null },
  });
  return NextResponse.json({ unreadCount });
}
