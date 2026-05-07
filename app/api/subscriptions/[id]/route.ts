import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SubscriptionSchema, SubscriptionBaseSchema } from "@/lib/validations";
import { auditLog, getActorEmail } from "@/lib/audit";

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

  // Use raw body keys — Zod .default() fills in values even with .partial()
  const sent = new Set(Object.keys(body));

  const before = await prisma.subscription.findUnique({ where: { id } });

  const data: Record<string, unknown> = {};
  if (sent.has("name")) data.name = parsed.data.name;
  if (sent.has("amount_cents")) data.amount_cents = parsed.data.amount_cents;
  if (sent.has("frequency")) data.frequency = parsed.data.frequency;
  if (sent.has("pay_day")) data.pay_day = parsed.data.pay_day;
  if (sent.has("pay_month")) data.pay_month = parsed.data.pay_month ?? null;
  if (sent.has("category")) data.category = parsed.data.category;
  if (sent.has("payment_mode")) data.payment_mode = parsed.data.payment_mode;
  if (sent.has("status")) data.status = parsed.data.status;
  if (sent.has("notes")) data.notes = parsed.data.notes ?? null;
  if (sent.has("icon_url")) data.icon_url = parsed.data.icon_url ?? null;

  const sub = await prisma.subscription.update({
    where: { id },
    data,
  });

  auditLog({
    entity_type: "subscription",
    entity_id: id,
    entity_name: sub.name,
    action: "update",
    actor_email: await getActorEmail(),
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
      actor_email: await getActorEmail(),
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
