import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTodayInTZ } from "@/lib/dates";
import { buildMetricsReport, recentMonths } from "@/lib/metrics";
import {
  loadCorporateExclusions,
  loadMonthlyRows,
  loadSentInvoices,
  loadUpcoming,
} from "@/lib/metrics-server";
import { MetricsQuerySchema } from "@/lib/validations";
import { requireSession, invalid, toApiResponse } from "@/lib/api";

/**
 * The dashboard's numbers, for clients that are not the web dashboard — the
 * mobile Metrics tab first. Computed by lib/metrics from rows loaded by
 * lib/metrics-server: the same code path as app/dashboard, so for the same
 * period and the same saved exclusions the numbers are identical.
 *
 *   ?period=this_year (default) | last_12_months | all_time
 *   ?month=YYYY-MM   — one explicit month instead of a preset
 *
 * "all_time" is the dashboard's: the 13 most recent months, trimmed of empty
 * months at both ends. Awaiting payment and upcoming are live and ignore the
 * period, as on the dashboard.
 */
export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = MetricsQuerySchema.safeParse(params);
  if (!parsed.success) return invalid(parsed.error);

  const today = getTodayInTZ();
  const selection = parsed.data.month
    ? { kind: "month" as const, month: parsed.data.month }
    : { kind: parsed.data.period ?? ("this_year" as const) };
  const months = selection.kind === "month" ? [selection.month] : recentMonths(today);

  try {
    const [rows, sent, upcoming, excludedIds] = await Promise.all([
      loadMonthlyRows(months),
      loadSentInvoices(),
      loadUpcoming(today),
      loadCorporateExclusions(),
    ]);
    const excludedClients =
      excludedIds.length > 0
        ? await prisma.client.findMany({
            where: { id: { in: excludedIds } },
            select: { id: true, name: true, color_hex: true },
            orderBy: { name: "asc" },
          })
        : [];

    return NextResponse.json(
      buildMetricsReport({ selection, months, rows, sent, upcoming, excludedClients, today })
    );
  } catch (err) {
    return toApiResponse(err);
  }
}
