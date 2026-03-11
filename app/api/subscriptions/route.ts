import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SubscriptionSchema } from "@/lib/validations";
import { auditLog } from "@/lib/audit";
import { getTodayInTZ } from "@/lib/dates";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");

  const today = getTodayInTZ();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;

  const startOfYear  = new Date(Date.UTC(y, 0, 1));
  const endOfYear    = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
  const startOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const endOfMonth   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

  const includePayments = {
    payments: {
      where: { deleted_at: null } as const,
      orderBy: { created_at: "desc" } as const,
      take: 1,
    },
  };

  const enrichWithPaidStatus = (
    subscriptions: Awaited<ReturnType<typeof prisma.subscription.findMany>>,
    yearPayments: { subscription_id: string; due_date: Date }[]
  ) =>
    subscriptions.map((s) => {
      const paid = yearPayments.some((p) => {
        if (p.subscription_id !== s.id) return false;
        if ((s as any).frequency === "annual") return true;
        return p.due_date >= startOfMonth && p.due_date <= endOfMonth;
      });
      return { ...s, paid_current_period: paid };
    });

  const yearPayments = await prisma.subscriptionPayment.findMany({
    where: {
      deleted_at: null,
      due_date: { gte: startOfYear, lte: endOfYear },
    },
    select: { subscription_id: true, due_date: true },
  });

  // Backward-compatible: no params = return all
  if (!pageParam && !limitParam) {
    const subscriptions = await prisma.subscription.findMany({
      orderBy: { created_at: "desc" },
      include: includePayments,
    });
    return NextResponse.json(enrichWithPaidStatus(subscriptions, yearPayments));
  }

  const page = Math.max(1, parseInt(pageParam ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitParam ?? "50") || 50));

  const [subscriptions, total] = await Promise.all([
    prisma.subscription.findMany({
      orderBy: { created_at: "desc" },
      include: includePayments,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.subscription.count(),
  ]);

  return NextResponse.json({
    data: enrichWithPaidStatus(subscriptions, yearPayments),
    total,
    page,
    limit,
  });
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
      icon_url: parsed.data.icon_url ?? null,
    },
  });

  auditLog({
    entity_type: "subscription",
    entity_id: sub.id,
    entity_name: sub.name,
    action: "create",
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

  return NextResponse.json(sub, { status: 201 });
}
