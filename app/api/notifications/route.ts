import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter") ?? "unread"; // "unread" | "all"
  const type = searchParams.get("type"); // optional filter by type
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50") || 50));

  const where: Record<string, unknown> = {};
  if (filter === "unread") where.read_at = null;
  if (type) where.type = type;

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where: { read_at: null } }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const notification = await prisma.notification.update({
    where: { id },
    data: { read_at: new Date() },
  });

  return NextResponse.json(notification);
}
