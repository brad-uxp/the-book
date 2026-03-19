import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const SettingsSchema = z.object({
  days_before_subscription: z.number().int().min(0).max(30).optional(),
  days_before_salary:       z.number().int().min(0).max(30).optional(),
  days_before_invoice:      z.number().int().min(0).max(30).optional(),
});

export async function GET() {
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  return NextResponse.json(settings ?? {
    id: "singleton",
    days_before_subscription: 2,
    days_before_salary:       4,
    days_before_invoice:      0,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: parsed.data,
    create: {
      id: "singleton",
      days_before_subscription: parsed.data.days_before_subscription ?? 2,
      days_before_salary:       parsed.data.days_before_salary ?? 4,
      days_before_invoice:      parsed.data.days_before_invoice ?? 0,
    },
  });

  return NextResponse.json(settings);
}
