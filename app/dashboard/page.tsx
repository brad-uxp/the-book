import { prisma } from "@/lib/db";
import { DashboardMetrics } from "@/components/dashboard/dashboard-metrics";
import { UpcomingCards } from "@/components/dashboard/upcoming-cards";
import {
  getTodayInTZ,
  addDaysUTC,
  clampDay,
} from "@/lib/dates";

export const dynamic = "force-dynamic";

function toPeriodKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Returns last 13 months (covers "This year" and "Last 12 months" presets).
 * Previously fetched 36 months — reduced to minimize DB load and payload size.
 */
function getRecentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (12 - i), 1);
    return toPeriodKey(d);
  });
}

export default async function DashboardPage() {
  const today = getTodayInTZ();
  const in5Days = addDaysUTC(today, 5);

  const todayYear  = today.getUTCFullYear();
  const todayMonth = today.getUTCMonth() + 1;
  const nextMonthDate = new Date(Date.UTC(todayYear, todayMonth, 1));
  const nextYear  = nextMonthDate.getUTCFullYear();
  const nextMonth = nextMonthDate.getUTCMonth() + 1;

  const startOfCurrentYear  = new Date(Date.UTC(todayYear, 0, 1));
  const startOfCurrentMonth = new Date(Date.UTC(todayYear, todayMonth - 1, 1));
  const startOfNextMonth    = new Date(Date.UTC(nextYear, nextMonth - 1, 1));
  const endOfNextMonth      = new Date(Date.UTC(nextYear, nextMonth, 0, 23, 59, 59, 999));

  // ── Chart / metrics data (13 months) ────────────────────────────────────────
  const months = getRecentMonths();
  const from = months[0];
  const to   = months[months.length - 1];

  const fromDate = new Date(from + "-01");
  const toDate   = new Date(parseInt(to.slice(0, 4)), parseInt(to.slice(5, 7)), 0);

  const sentInvoices = await prisma.invoice.aggregate({
    where: { status: "sent" },
    _count: { id: true },
    _sum: { amount_cents: true, fee_cents: true },
  });
  const sentCount = sentInvoices._count.id;
  const sentTotal = (sentInvoices._sum.amount_cents ?? 0) + (sentInvoices._sum.fee_cents ?? 0);

  const [subPayments, salaryPayments, invoices, otherExpenses] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { deleted_at: null, paid_at: { gte: fromDate, lte: toDate } },
      select: {
        paid_at: true,
        amount_cents_snapshot: true,
        subscription: { select: { id: true, name: true, category: true } },
      },
    }),
    prisma.salaryPayment.findMany({
      where: { paid_at: { gte: fromDate, lte: toDate } },
      select: {
        paid_at: true,
        total_cents: true,
        person_id: true,
        person: { select: { name: true } },
      },
    }),
    prisma.invoice.findMany({
      where: { status: "paid", due_date: { gte: fromDate, lte: toDate } },
      select: {
        due_date: true,
        amount_cents: true,
        fee_cents: true,
        client_id: true,
        client: { select: { name: true, color_hex: true } },
      },
    }),
    prisma.otherExpense.findMany({
      where: { paid_at: { gte: fromDate, lte: toDate } },
      select: { paid_at: true, amount_cents: true, category: true, name: true },
    }),
  ]);

  // Per-type monthly buckets — pre-index by month key for O(n) instead of O(months*payments)
  type Bucket = { income: number; salary: number; subscriptions: number; subsPersonal: number; subsWork: number; subsEssential: number; other: number; otherWork: number; otherPersonal: number };
  const emptyBucket = (): Bucket => ({ income: 0, salary: 0, subscriptions: 0, subsPersonal: 0, subsWork: 0, subsEssential: 0, other: 0, otherWork: 0, otherPersonal: 0 });
  const buckets = new Map<string, Bucket>(months.map((m) => [m, emptyBucket()]));

  for (const p of salaryPayments) {
    const b = buckets.get(toPeriodKey(p.paid_at));
    if (b) b.salary += p.total_cents;
  }
  for (const p of subPayments) {
    const b = buckets.get(toPeriodKey(p.paid_at));
    if (b) {
      b.subscriptions += p.amount_cents_snapshot;
      if (p.subscription.category === "personal") b.subsPersonal += p.amount_cents_snapshot;
      else if (p.subscription.category === "work") b.subsWork += p.amount_cents_snapshot;
      else if (p.subscription.category === "essential_service") b.subsEssential += p.amount_cents_snapshot;
    }
  }
  for (const p of otherExpenses) {
    const b = buckets.get(toPeriodKey(p.paid_at));
    if (b) {
      b.other += p.amount_cents;
      if (p.category === "work") b.otherWork += p.amount_cents;
      else if (p.category === "personal") b.otherPersonal += p.amount_cents;
    }
  }
  // Per-month per-source work expense breakdown (used by PDF export)
  type WorkRow = { id: string; name: string; monthly: Record<string, number> };
  const ensureWorkRow = (rows: Map<string, WorkRow>, id: string, name: string): WorkRow => {
    let row = rows.get(id);
    if (!row) {
      row = { id, name, monthly: Object.fromEntries(months.map((m) => [m, 0])) };
      rows.set(id, row);
    }
    return row;
  };
  const salariesRows = new Map<string, WorkRow>();
  const workSubsRows = new Map<string, WorkRow>();
  const workOtherRows = new Map<string, WorkRow>();

  for (const p of salaryPayments) {
    const monthKey = toPeriodKey(p.paid_at);
    if (!buckets.has(monthKey)) continue;
    const row = ensureWorkRow(salariesRows, p.person_id, p.person.name);
    row.monthly[monthKey] = (row.monthly[monthKey] ?? 0) + p.total_cents;
  }
  for (const p of subPayments) {
    if (p.subscription.category !== "work") continue;
    const monthKey = toPeriodKey(p.paid_at);
    if (!buckets.has(monthKey)) continue;
    const row = ensureWorkRow(workSubsRows, p.subscription.id, p.subscription.name);
    row.monthly[monthKey] = (row.monthly[monthKey] ?? 0) + p.amount_cents_snapshot;
  }
  for (const p of otherExpenses) {
    if (p.category !== "work") continue;
    const monthKey = toPeriodKey(p.paid_at);
    if (!buckets.has(monthKey)) continue;
    // Group by name (OtherExpense has no stable id concept across entries with same name)
    const row = ensureWorkRow(workOtherRows, p.name, p.name);
    row.monthly[monthKey] = (row.monthly[monthKey] ?? 0) + p.amount_cents;
  }

  const workExpensesByItem = {
    salaries: Array.from(salariesRows.values()),
    workSubs: Array.from(workSubsRows.values()),
    workOther: Array.from(workOtherRows.values()),
  };

  // Per-month per-client income (used by Corporate chart's "exclude clients" toggle)
  const incomeBuckets = new Map<string, Map<string, number>>(months.map((m) => [m, new Map()]));
  const clientsIndex: Record<string, { name: string; color: string }> = {};

  for (const inv of invoices) {
    const monthKey = toPeriodKey(inv.due_date);
    const b = buckets.get(monthKey);
    const total = inv.amount_cents + inv.fee_cents;
    if (b) b.income += total;

    const ib = incomeBuckets.get(monthKey);
    if (ib) {
      ib.set(inv.client_id, (ib.get(inv.client_id) ?? 0) + total);
      if (!clientsIndex[inv.client_id]) {
        clientsIndex[inv.client_id] = { name: inv.client.name, color: inv.client.color_hex };
      }
    }
  }

  const monthlyData = months.map((month) => ({ month, ...buckets.get(month)! }));
  const monthlyIncomeByClient = months.map((month) => ({
    month,
    byClient: Object.fromEntries(incomeBuckets.get(month)!),
  }));

  // ── Upcoming data ───────────────────────────────────────────────────────────
  const [activeSubscriptions, activePeople, upcomingInvoices] = await Promise.all([
    prisma.subscription.findMany({
      where: { status: "active" },
      select: {
        id: true, name: true, amount_cents: true,
        frequency: true, pay_day: true, pay_month: true,
        payments: {
          where: { deleted_at: null, due_date: { gte: startOfCurrentYear, lte: endOfNextMonth } },
          select: { due_date: true },
        },
      },
    }),
    prisma.person.findMany({
      where: { status: "active" },
      select: {
        id: true, name: true, payday_day: true,
        salary_base: { select: { base_salary_cents: true } },
        salary_payments: {
          where: { due_date: { gte: startOfCurrentMonth, lte: endOfNextMonth } },
          select: { due_date: true },
        },
      },
    }),
    prisma.invoice.findMany({
      where: { status: { not: "paid" }, due_date: { gte: today, lte: in5Days } },
      include: { client: true },
      orderBy: { due_date: "asc" },
    }),
  ]);

  const upcomingSubPayments = activeSubscriptions.flatMap((sub) => {
    const paidDueDates = new Set(sub.payments.map((p) => p.due_date.toISOString()));
    for (let i = 0; i <= 5; i++) {
      const checkDate = addDaysUTC(today, i);
      const y = checkDate.getUTCFullYear();
      const m = checkDate.getUTCMonth() + 1;
      const d = checkDate.getUTCDate();

      let isDue = false;
      let dueDate: Date | null = null;

      if (sub.frequency === "monthly") {
        isDue = clampDay(y, m, sub.pay_day) === d;
        if (isDue) dueDate = new Date(Date.UTC(y, m - 1, clampDay(y, m, sub.pay_day)));
      } else {
        isDue = sub.pay_month === m && clampDay(y, m, sub.pay_day) === d;
        if (isDue) dueDate = new Date(Date.UTC(y, m - 1, clampDay(y, m, sub.pay_day)));
      }

      if (isDue && dueDate) {
        if (!paidDueDates.has(dueDate.toISOString())) {
          return [{ id: sub.id, type: "subscription" as const, name: sub.name, amount_cents: sub.amount_cents, due_date: checkDate.toISOString() }];
        }
        break;
      }
    }
    return [];
  });

  const upcomingSalaryPayments = activePeople.flatMap((person) => {
    const paidDueDates = new Set(person.salary_payments.map((p) => p.due_date.toISOString()));
    for (let i = 0; i <= 5; i++) {
      const checkDate = addDaysUTC(today, i);
      const y = checkDate.getUTCFullYear();
      const m = checkDate.getUTCMonth() + 1;
      const d = checkDate.getUTCDate();

      if (clampDay(y, m, person.payday_day) === d) {
        const dueDate = new Date(Date.UTC(y, m - 1, clampDay(y, m, person.payday_day)));
        if (!paidDueDates.has(dueDate.toISOString())) {
          return [{ id: person.id, type: "salary" as const, name: person.name, amount_cents: person.salary_base?.base_salary_cents ?? 0, due_date: checkDate.toISOString() }];
        }
        break;
      }
    }
    return [];
  });

  const upcomingPayments = [...upcomingSubPayments, ...upcomingSalaryPayments].sort(
    (a, b) => a.due_date.localeCompare(b.due_date)
  );

  const upcomingInvoicesList = upcomingInvoices.map((inv) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    client: { name: inv.client.name, color_hex: inv.client.color_hex },
    amount_cents: inv.amount_cents,
    fee_cents: inv.fee_cents,
    status: inv.status,
    due_date: inv.due_date.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monthly income vs expenses overview.
        </p>
      </div>

      {/* Metrics: filter toggle + summary cards + chart */}
      <DashboardMetrics
        monthlyData={monthlyData}
        monthlyIncomeByClient={monthlyIncomeByClient}
        clientsIndex={clientsIndex}
        workExpensesByItem={workExpensesByItem}
        sentTotal={sentTotal}
        sentCount={sentCount}
      />

      {/* Upcoming section — always live, outside filter scope */}
      <div className="-mx-4 lg:-mx-6 -mb-4 lg:-mb-6 border-t bg-muted/30 px-4 lg:px-6 pt-6 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Upcoming · Next 5 days
        </p>
        <UpcomingCards payments={upcomingPayments} invoices={upcomingInvoicesList} />
      </div>
    </div>
  );
}
