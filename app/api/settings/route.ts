import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const SettingsSchema = z.object({
  email_recipient:          z.string().email("Must be a valid email").or(z.literal("")).nullable().optional(),
  days_before_subscription: z.number().int().min(0).max(30).optional(),
  days_before_salary:       z.number().int().min(0).max(30).optional(),
  days_before_invoice:      z.number().int().min(0).max(30).optional(),
});

export async function GET() {
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  return NextResponse.json(settings ?? {
    id: "singleton",
    email_recipient:          null,
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

  const data = {
    ...parsed.data,
    // Treat empty string as null for email
    email_recipient: parsed.data.email_recipient === "" ? null : parsed.data.email_recipient,
  };

  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: data,
    create: {
      id: "singleton",
      email_recipient:          data.email_recipient ?? null,
      days_before_subscription: data.days_before_subscription ?? 2,
      days_before_salary:       data.days_before_salary ?? 4,
      days_before_invoice:      data.days_before_invoice ?? 0,
    },
  });

  return NextResponse.json(settings);
}
