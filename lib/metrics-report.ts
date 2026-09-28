/**
 * The shape of GET /api/metrics, as a type with no imports.
 *
 * lib/metrics builds it (and is checked against it); the Android app's Metrics
 * tab reads it through `@shared/metrics-report`. lib/metrics itself cannot
 * reach the app — it imports date-fns through lib/dates — so the contract
 * lives here, where both sides compile against the same definition.
 *
 * Integer cents throughout; dates are ISO strings.
 */

export type MetricsPeriod = "this_year" | "last_12_months";

export interface UpcomingPayment {
  id: string;
  type: "subscription" | "salary";
  name: string;
  amount_cents: number;
  /** ISO string of the day it falls due. */
  due_date: string;
}

export interface UpcomingInvoice {
  id: string;
  invoice_number: string | null;
  client: { name: string; color_hex: string };
  amount_cents: number;
  fee_cents: number;
  status: string;
  due_date: string;
  /** amount + fee: what it brings in. */
  net_cents: number;
}

export interface MetricsReport {
  period: { kind: MetricsPeriod | "month"; months: string[] };
  /** YYYY-MM-DD, Montevideo. */
  today: string;
  /** Sent invoices, whatever the period. */
  awaiting_payment: { count: number; net_cents: number; past_due_count: number };
  income_cents: number;
  expenses: {
    salary_cents: number;
    subscriptions_cents: number;
    subscriptions_work_cents: number;
    subscriptions_personal_cents: number;
    subscriptions_essential_cents: number;
    other_cents: number;
    other_work_cents: number;
    other_personal_cents: number;
    total_cents: number;
  };
  net_income_cents: number;
  monthly_averages: {
    months: number;
    salary_cents: number;
    subscriptions_personal_cents: number;
    subscriptions_work_cents: number;
    subscriptions_essential_cents: number;
    total_expense_cents: number;
    net_income_cents: number;
  };
  corporate: {
    income_cents: number;
    excluded_income_cents: number;
    excluded_clients: { id: string; name: string; color_hex: string }[];
    work_expenses_cents: number;
    net_cents: number;
    partner_a_cents: number;
    partner_b_cents: number;
    split: { partner_a: number; partner_b: number };
  };
  /** The next `days` days, today included; whatever the period. */
  upcoming: { days: number; payments: UpcomingPayment[]; invoices: UpcomingInvoice[] };
}
