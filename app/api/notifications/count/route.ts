import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const unreadCount = await prisma.notification.count({
    where: { read_at: null },
  });
  return NextResponse.json({ unreadCount });
}
