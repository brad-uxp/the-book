import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { lastNMonths, monthlyPeriodKey } from "@/lib/dates";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") ?? "list"; // "list" | "summary"
  const months = parseInt(searchParams.get("months") ?? "12");

  const [subPayments, salaryPayments] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { deleted_at: null },
      include: { subscription: { select: { name: true, category: true } } },
      orderBy: { paid_at: "desc" },
    }),
    prisma.salaryPayment.findMany({
      include: { person: { select: { name: true } } },
      orderBy: { paid_at: "desc" },
    }),
  ]);

  if (view === "list") {
    const combined = [
      ...subPayments.map((p) => ({
        id: p.id,
        type: "subscription" as const,
        name: p.subscription.name,
        category: p.subscription.category,
        paid_at: p.paid_at,
        amount_cents: p.amount_cents_snapshot,
        source_id: p.subscription_id,
      })),
      ...salaryPayments.map((p) => ({
        id: p.id,
        type: "salary" as const,
        name: p.person.name,
        category: null,
        paid_at: p.paid_at,
        amount_cents: p.total_cents,
        source_id: p.person_id,
      })),
    ].sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

    return NextResponse.json({ items: combined });
  }

  // Summary: group by month
  const periodList = lastNMonths(months);
  const periodKeys = new Set(periodList.map((p) => p.periodKey));

  // Build monthly aggregates
  const byMonth: Record<
    string,
    { subscriptions: number; salaries: number; byCategory: Record<string, number> }
  > = {};

  for (const period of periodList) {
    byMonth[period.periodKey] = { subscriptions: 0, salaries: 0, byCategory: {} };
  }

  for (const p of subPayments) {
    // Only include payments whose paid_at falls within our period
    const paidDate = new Date(p.paid_at);
    const pKey = monthlyPeriodKey(
      paidDate.getUTCFullYear(),
      paidDate.getUTCMonth() + 1
    );
    if (!byMonth[pKey]) continue;
    byMonth[pKey].subscriptions += p.amount_cents_snapshot;
    const cat = p.subscription.category;
    byMonth[pKey].byCategory[cat] =
      (byMonth[pKey].byCategory[cat] ?? 0) + p.amount_cents_snapshot;
  }

  for (const p of salaryPayments) {
    const paidDate = new Date(p.paid_at);
    const pKey = monthlyPeriodKey(
      paidDate.getUTCFullYear(),
      paidDate.getUTCMonth() + 1
    );
    if (!byMonth[pKey]) continue;
    byMonth[pKey].salaries += p.total_cents;
  }

  const chartData = periodList.map((period) => ({
    period: period.periodKey,
    subscriptions: byMonth[period.periodKey]?.subscriptions ?? 0,
    salaries: byMonth[period.periodKey]?.salaries ?? 0,
    total:
      (byMonth[period.periodKey]?.subscriptions ?? 0) +
      (byMonth[period.periodKey]?.salaries ?? 0),
    byCategory: byMonth[period.periodKey]?.byCategory ?? {},
  }));

  return NextResponse.json({ chartData });
}
