import { DashboardMetrics } from "@/components/dashboard/dashboard-metrics";
import { UpcomingCards } from "@/components/dashboard/upcoming-cards";
import { getTodayInTZ } from "@/lib/dates";
import {
  awaitingOf,
  bucketByMonth,
  recentMonths,
  workExpensesByItemOf,
} from "@/lib/metrics";
import {
  loadMonthlyRows,
  loadSentInvoices,
  loadUpcoming,
} from "@/lib/metrics-server";

export const dynamic = "force-dynamic";

/**
 * The numbers are computed in lib/metrics (pure, tested) from rows loaded by
 * lib/metrics-server — the same path GET /api/metrics takes. This page only
 * lays them out.
 */
export default async function DashboardPage() {
  const today = getTodayInTZ();

  // 13 months: enough for "This year" and "Last 12 months". "All time" is
  // these same months, trimmed of empty ones at both ends.
  const months = recentMonths(today);

  const [rows, sent, upcoming] = await Promise.all([
    loadMonthlyRows(months),
    loadSentInvoices(),
    loadUpcoming(today),
  ]);

  const { monthly, incomeByClient } = bucketByMonth(months, rows);
  const awaiting = awaitingOf(sent, today);
  const workExpensesByItem = workExpensesByItemOf(months, rows);

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
        monthlyData={monthly}
        monthlyIncomeByClient={incomeByClient}
        clientsIndex={rows.clientsIndex}
        workExpensesByItem={workExpensesByItem}
        sentTotal={awaiting.netCents}
        sentCount={awaiting.count}
      />

      {/* Upcoming section — always live, outside filter scope */}
      <div className="-mx-4 lg:-mx-6 -mb-4 lg:-mb-6 border-t bg-muted/30 px-4 lg:px-6 pt-6 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Upcoming · Next 5 days
        </p>
        <UpcomingCards payments={upcoming.payments} invoices={upcoming.invoices} />
      </div>
    </div>
  );
}
