import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTodayInTZ, calcMonthlyDueDate, calcAnnualDueDate } from "@/lib/dates";
import { auditLog } from "@/lib/audit";

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
  const { paid_at, amount_cents } = body;

  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const paidDate = paid_at ? new Date(paid_at) : getTodayInTZ();
  const year = paidDate.getUTCFullYear();
  const month = paidDate.getUTCMonth() + 1;

  let dueDate: Date;
  let startOfPeriod: Date;
  let endOfPeriod: Date;

  if (sub.frequency === "monthly") {
    dueDate = calcMonthlyDueDate(year, month, sub.pay_day);
    startOfPeriod = new Date(Date.UTC(year, month - 1, 1));
    endOfPeriod   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  } else {
    const payMonth = sub.pay_month ?? 1;
    dueDate = calcAnnualDueDate(year, payMonth, sub.pay_day);
    startOfPeriod = new Date(Date.UTC(year, 0, 1));
    endOfPeriod   = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  }

  // Check for existing non-deleted payment in the same period
  const existing = await prisma.subscriptionPayment.findFirst({
    where: {
      subscription_id: id,
      deleted_at: null,
      due_date: { gte: startOfPeriod, lte: endOfPeriod },
    },
  });
  if (existing) {
    const label = sub.frequency === "monthly"
      ? `${year}-${String(month).padStart(2, "0")}`
      : String(year);
    return NextResponse.json(
      { error: `Payment for period ${label} already exists` },
      { status: 409 }
    );
  }

  const snapshot = amount_cents ?? sub.amount_cents;

  const payment = await prisma.subscriptionPayment.create({
    data: {
      subscription_id: id,
      due_date: dueDate,
      paid_at: new Date(paid_at ?? getTodayInTZ()),
      amount_cents_snapshot: snapshot,
    },
  });

  const periodLabel = dueDate.toISOString().slice(0, 7);
  auditLog({
    entity_type: "subscription_payment",
    entity_id: payment.id,
    entity_name: `${sub.name} – ${periodLabel}`,
    action: "create",
    after: {
      subscription_id: payment.subscription_id,
      due_date: payment.due_date,
      paid_at: payment.paid_at,
      amount_cents_snapshot: payment.amount_cents_snapshot,
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

  const before = await prisma.subscriptionPayment.findUnique({
    where: { id: paymentId },
    include: { subscription: true },
  });

  await prisma.subscriptionPayment.update({
    where: { id: paymentId },
    data: { deleted_at: new Date() },
  });

  if (before) {
    const periodLabel = before.due_date.toISOString().slice(0, 7);
    auditLog({
      entity_type: "subscription_payment",
      entity_id: paymentId,
      entity_name: `${before.subscription.name} – ${periodLabel}`,
      action: "delete",
      before: {
        subscription_id: before.subscription_id,
        due_date: before.due_date,
        paid_at: before.paid_at,
        amount_cents_snapshot: before.amount_cents_snapshot,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
