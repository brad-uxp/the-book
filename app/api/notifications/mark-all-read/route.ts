import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  await prisma.notification.updateMany({
    where: { read_at: null },
    data: { read_at: new Date() },
  });
  return NextResponse.json({ ok: true });
}
