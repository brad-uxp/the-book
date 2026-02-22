import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SubscriptionSchema, SubscriptionBaseSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: {
      payments: {
        where: { deleted_at: null },
        orderBy: { due_date: "desc" },
      },
    },
  });
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(sub);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = SubscriptionBaseSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const before = await prisma.subscription.findUnique({ where: { id } });

  const sub = await prisma.subscription.update({
    where: { id },
    data: {
      ...parsed.data,
      pay_month: parsed.data.pay_month ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  auditLog({
    entity_type: "subscription",
    entity_id: id,
    entity_name: sub.name,
    action: "update",
    before: before ? {
      name: before.name,
      amount_cents: before.amount_cents,
      frequency: before.frequency,
      pay_day: before.pay_day,
      pay_month: before.pay_month,
      category: before.category,
      payment_mode: before.payment_mode,
      status: before.status,
      notes: before.notes,
    } : null,
    after: {
      name: sub.name,
      amount_cents: sub.amount_cents,
      frequency: sub.frequency,
      pay_day: sub.pay_day,
      pay_month: sub.pay_month,
      category: sub.category,
      payment_mode: sub.payment_mode,
      status: sub.status,
      notes: sub.notes,
    },
  });

  return NextResponse.json(sub);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const before = await prisma.subscription.findUnique({ where: { id } });
  await prisma.subscription.delete({ where: { id } });

  if (before) {
    auditLog({
      entity_type: "subscription",
      entity_id: id,
      entity_name: before.name,
      action: "delete",
      before: {
        name: before.name,
        amount_cents: before.amount_cents,
        frequency: before.frequency,
        pay_day: before.pay_day,
        pay_month: before.pay_month,
        category: before.category,
        payment_mode: before.payment_mode,
        status: before.status,
        notes: before.notes,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
