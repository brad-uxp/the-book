import { prisma } from "@/lib/db";
import { ExpenseCharts } from "@/components/expenses/expense-charts";
import { ExpenseTable } from "@/components/expenses/expense-table";
import { lastNMonths, monthlyPeriodKey } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
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

  // Build unified expense list
  const items = [
    ...subPayments.map((p) => ({
      id: p.id,
      type: "subscription" as const,
      name: p.subscription.name,
      category: p.subscription.category as string,
      paid_at: p.paid_at.toISOString(),
      amount_cents: p.amount_cents_snapshot,
      period_key: p.period_key,
      source_id: p.subscription_id,
    })),
    ...salaryPayments.map((p) => ({
      id: p.id,
      type: "salary" as const,
      name: p.person.name,
      category: null,
      paid_at: p.paid_at.toISOString(),
      amount_cents: p.total_cents,
      period_key: p.period_key,
      source_id: p.person_id,
    })),
  ].sort(
    (a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()
  );

  // Build chart data for last 12 months
  const periodList = lastNMonths(12);
  const byMonth: Record<
    string,
    { subscriptions: number; salaries: number; byCategory: Record<string, number> }
  > = {};

  for (const period of periodList) {
    byMonth[period.periodKey] = { subscriptions: 0, salaries: 0, byCategory: {} };
  }

  for (const p of subPayments) {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Expenses</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Unified view of all subscriptions and salary payments.
        </p>
      </div>

      <ExpenseCharts chartData={chartData} />

      <div>
        <h2 className="text-lg font-semibold mb-4">Transaction History</h2>
        <ExpenseTable items={items} />
      </div>
    </div>
  );
}
