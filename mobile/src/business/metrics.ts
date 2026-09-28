import type { MetricsReport } from "../../../lib/metrics-report.ts";
import { shiftMonth } from "../lib/format.ts";

/**
 * The Metrics tab asks GET /api/metrics for one period and shows its answer as
 * it comes: every number is computed on the server by lib/metrics — the code
 * the web dashboard uses — and never again here.
 *
 * Pure (relative imports with the extension), so it runs under `node --test`.
 */

export type { MetricsReport };

/** The web's presets, and one month at a time. */
export type MetricsView = { kind: "this_year" } | { kind: "last_12_months" } | { kind: "month"; month: string };

export function metricsPath(view: MetricsView): string {
  return view.kind === "month" ? `/api/metrics?month=${view.month}` : `/api/metrics?period=${view.kind}`;
}

/** The business_cache key its answer is kept under. */
export function metricsCacheKey(view: MetricsView): string {
  return view.kind === "month" ? `metrics:month:${view.month}` : `metrics:${view.kind}`;
}

/** Title for the net income card: "this year", "last 12 months", "Sep 2026". */
export function periodPhrase(view: MetricsView, monthLabel: (m: string) => string): string {
  if (view.kind === "this_year") return "this year";
  if (view.kind === "last_12_months") return "last 12 months";
  return monthLabel(view.month);
}

/** A month view moved by whole months, never past the current one. */
export function stepMonth(view: Extract<MetricsView, { kind: "month" }>, delta: number, current: string): MetricsView {
  const next = shiftMonth(view.month, delta);
  return { kind: "month", month: next > current ? current : next };
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Enough of a check that a stale or foreign answer (an error page, an older
 * server) is refused instead of drawn as zeros.
 */
export function toMetricsReport(raw: unknown): MetricsReport {
  const r = raw as Partial<MetricsReport> | null;
  const ok =
    !!r &&
    typeof r === "object" &&
    !!r.awaiting_payment &&
    isNum(r.awaiting_payment.count) &&
    isNum(r.awaiting_payment.net_cents) &&
    isNum(r.net_income_cents) &&
    !!r.monthly_averages &&
    isNum(r.monthly_averages.net_income_cents) &&
    !!r.corporate &&
    isNum(r.corporate.net_cents) &&
    isNum(r.corporate.partner_a_cents) &&
    isNum(r.corporate.partner_b_cents) &&
    Array.isArray(r.corporate.excluded_clients) &&
    !!r.upcoming &&
    Array.isArray(r.upcoming.payments) &&
    Array.isArray(r.upcoming.invoices);
  if (!ok) throw new Error("Unexpected answer from the server");
  return r as MetricsReport;
}

/** "60%" from the split the server sends (0.6). */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
