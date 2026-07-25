import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession, readJson, invalid, toApiResponse } from "@/lib/api";
import { NotificationType } from "@/app/generated/prisma/enums";

const NotificationTypeSchema = z.enum(
  Object.values(NotificationType) as [string, ...string[]]
);

const MarkReadSchema = z.object({ id: z.string().min(1, "id is required") });

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter") ?? "unread"; // "unread" | "all"
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50") || 50));

  // An unrecognised ?type= used to reach Prisma as an enum value and blow up
  // with a 500; an unknown filter value is simply ignored.
  const rawType = searchParams.get("type");
  const parsedType = rawType ? NotificationTypeSchema.safeParse(rawType) : null;
  if (parsedType && !parsedType.success) {
    return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
  }

  const where: Record<string, unknown> = {};
  if (filter === "unread") where.read_at = null;
  if (parsedType?.success) where.type = parsedType.data;

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
  const denied = await requireSession();
  if (denied) return denied;
  const parsed = MarkReadSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const notification = await prisma.notification.update({
      where: { id: parsed.data.id },
      data: { read_at: new Date() },
    });
    return NextResponse.json(notification);
  } catch (err) {
    return toApiResponse(err);
  }
}
