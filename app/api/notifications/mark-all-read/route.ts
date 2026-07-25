import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api";

export async function POST() {
  const denied = await requireSession();
  if (denied) return denied;
  await prisma.notification.updateMany({
    where: { read_at: null },
    data: { read_at: new Date() },
  });
  return NextResponse.json({ ok: true });
}
