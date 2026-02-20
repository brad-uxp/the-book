import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTodayInTZ, calcMonthlyDueDate, calcAnnualDueDate, monthlyPeriodKey, annualPeriodKey } from "@/lib/dates";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const payments = await prisma.subscriptionPayment.findMany({
    where: { subscription_id: id, deleted_at: null },
    orderBy: { due_date: "desc" },
  });
  return NextResponse.json(payments);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { paid_at } = body;

  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const paidDate = paid_at ? new Date(paid_at) : getTodayInTZ();
  const year = paidDate.getUTCFullYear();
  const month = paidDate.getUTCMonth() + 1;

  let periodKey: string;
  let dueDate: Date;

  if (sub.frequency === "monthly") {
    periodKey = monthlyPeriodKey(year, month);
    dueDate = calcMonthlyDueDate(year, month, sub.pay_day);
  } else {
    const payMonth = sub.pay_month ?? 1;
    periodKey = annualPeriodKey(year);
    dueDate = calcAnnualDueDate(year, payMonth, sub.pay_day);
  }

  // Check for existing non-deleted payment
  const existing = await prisma.subscriptionPayment.findFirst({
    where: { subscription_id: id, period_key: periodKey, deleted_at: null },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Payment for period ${periodKey} already exists` },
      { status: 409 }
    );
  }

  const payment = await prisma.subscriptionPayment.create({
    data: {
      subscription_id: id,
      period_key: periodKey,
      due_date: dueDate,
      paid_at: new Date(paid_at ?? getTodayInTZ()),
      amount_cents_snapshot: sub.amount_cents,
    },
  });

  return NextResponse.json(payment, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const paymentId = searchParams.get("paymentId");
  if (!paymentId) {
    return NextResponse.json({ error: "paymentId required" }, { status: 400 });
  }

  await prisma.subscriptionPayment.update({
    where: { id: paymentId },
    data: { deleted_at: new Date() },
  });

  return NextResponse.json({ ok: true });
}
