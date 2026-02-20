import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SubscriptionSchema } from "@/lib/validations";

export async function GET() {
  const subscriptions = await prisma.subscription.findMany({
    orderBy: { created_at: "desc" },
    include: {
      payments: {
        where: { deleted_at: null },
        orderBy: { created_at: "desc" },
        take: 1,
      },
    },
  });
  return NextResponse.json(subscriptions);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = SubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const sub = await prisma.subscription.create({
    data: {
      name: parsed.data.name,
      amount_cents: parsed.data.amount_cents,
      frequency: parsed.data.frequency,
      pay_day: parsed.data.pay_day,
      pay_month: parsed.data.pay_month ?? null,
      category: parsed.data.category,
      payment_mode: parsed.data.payment_mode,
      status: parsed.data.status ?? "active",
      notes: parsed.data.notes ?? null,
    },
  });

  return NextResponse.json(sub, { status: 201 });
}
