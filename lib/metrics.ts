/**
 * Every number the dashboard shows, computed in one place.
 *
 * Pure: rows in, numbers out, no database and no clock of its own — "today" is
 * always passed in. The web dashboard and GET /api/metrics (which the mobile
 * Metrics tab reads) both go through here, so the two can never disagree about
 * what "net income" or "corporate profitability" means.
 *
 * Money is integer cents throughout. Months are "YYYY-MM" keys read from UTC
 * components: every date in this database is stored at UTC midnight.
 */

import { addDaysUTC, clampDay, monthlyPeriodKey } from "./dates";

// ── Months ──────────────────────────────────────────────────────────────────

/** Month bucket for a stored date, from its UTC components. */
export function periodKeyOf(date: Date): string {
  return monthlyPeriodKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/** The `count` months ending with today's, oldest first. */
export function recentMonths(today: Date, count = 13): string[] {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - (count - 1 - i), 1));
    return periodKeyOf(d);
  });
}

/** First instant and last instant of a run of months, in UTC. */
export function monthRange(months: string[]): { from: Date; to: Date } {
  const first = months[0];
  const last = months[months.length - 1];
  return {
    from: new Date(first + "-01"),
    to: new Date(
      Date.UTC(parseInt(last.slice(0, 4)), parseInt(last.slice(5, 7)), 0, 23, 59, 59, 999)
    ),
  };
}

// ── Monthly buckets ─────────────────────────────────────────────────────────

export interface MonthData {
  month: string;
  income: number;
  salary: number;
  subscriptions: number;
  subsPersonal: number;
  subsWork: number;
  subsEssential: number;
  other: number;
  otherWork: number;
  otherPersonal: number;
}

export interface MonthIncomeByClient {
  month: string;
  byClient: Record<string, number>;
}

/** A paid invoice. Income is booked in the month of its due date. */
export interface PaidInvoiceRow {
  due_date: Date;
  amount_cents: number;
  fee_cents: number;
  client_id: string;
}

export interface SalaryPaymentRow {
  paid_at: Date;
  total_cents: number;
}

/** Soft-deleted payments must already be filtered out by the caller. */
export interface SubscriptionPaymentRow {
  paid_at: Date;
  amount_cents_snapshot: number;
  category: string;
}

export interface OtherExpenseRow {
  paid_at: Date;
  amount_cents: number;
  category: string;
}

export interface MonthlyInputs {
  invoices: PaidInvoiceRow[];
  salaries: SalaryPaymentRow[];
  subscriptions: SubscriptionPaymentRow[];
  others: OtherExpenseRow[];
}

const emptyMonth = (month: string): MonthData => ({
  month,
  income: 0,
  salary: 0,
  subscriptions: 0,
  subsPersonal: 0,
  subsWork: 0,
  subsEssential: 0,
  other: 0,
  otherWork: 0,
  otherPersonal: 0,
});

/**
 * Sums every row into its month. Rows outside `months` are ignored.
 *
 * Income is amount + fee: the fee is stored negative (the referrer's cut), so
 * the sum is what the company keeps. Invoices go by due_date, payments by
 * paid_at — the same split the dashboard has always used.
 */
export function bucketByMonth(
  months: string[],
  rows: MonthlyInputs
): { monthly: MonthData[]; incomeByClient: MonthIncomeByClient[] } {
  const buckets = new Map(months.map((m) => [m, emptyMonth(m)]));
  const byClient = new Map(months.map((m) => [m, new Map<string, number>()]));

  for (const p of rows.salaries) {
    const b = buckets.get(periodKeyOf(p.paid_at));
    if (b) b.salary += p.total_cents;
  }
  for (const p of rows.subscriptions) {
    const b = buckets.get(periodKeyOf(p.paid_at));
    if (!b) continue;
    b.subscriptions += p.amount_cents_snapshot;
    if (p.category === "personal") b.subsPersonal += p.amount_cents_snapshot;
    else if (p.category === "work") b.subsWork += p.amount_cents_snapshot;
    else if (p.category === "essential_service") b.subsEssential += p.amount_cents_snapshot;
  }
  for (const p of rows.others) {
    const b = buckets.get(periodKeyOf(p.paid_at));
    if (!b) continue;
    b.other += p.amount_cents;
    if (p.category === "work") b.otherWork += p.amount_cents;
    else if (p.category === "personal") b.otherPersonal += p.amount_cents;
  }
  for (const inv of rows.invoices) {
    const key = periodKeyOf(inv.due_date);
    const total = inv.amount_cents + inv.fee_cents;
    const b = buckets.get(key);
    if (b) b.income += total;
    const c = byClient.get(key);
    if (c) c.set(inv.client_id, (c.get(inv.client_id) ?? 0) + total);
  }

  return {
    monthly: months.map((m) => buckets.get(m)!),
    incomeByClient: months.map((m) => ({
      month: m,
      byClient: Object.fromEntries(byClient.get(m)!),
    })),
  };
}

// ── Periods ─────────────────────────────────────────────────────────────────

/**
 * The dashboard's presets: this year and the last 12 months. "All time" was
 * dropped on 2026-09-27 — unused, and it only ever meant the 13 loaded months.
 */
export type Preset = "ytd" | "last12";

/** The months a preset shows, up to and including the current one. */
export function filterMonths(monthly: MonthData[], preset: Preset, today: Date): MonthData[] {
  const currentMonth = periodKeyOf(today);
  if (preset === "ytd") {
    const yearStart = `${today.getUTCFullYear()}-01`;
    return monthly.filter((d) => d.month >= yearStart && d.month <= currentMonth);
  }
  const from = periodKeyOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1)));
  return monthly.filter((d) => d.month >= from && d.month <= currentMonth);
}

// ── Totals ──────────────────────────────────────────────────────────────────

export interface Totals {
  income: number;
  salary: number;
  subscriptions: number;
  subsPersonal: number;
  subsWork: number;
  subsEssential: number;
  other: number;
  otherWork: number;
  otherPersonal: number;
  /** salary + subscriptions + other */
  expenses: number;
  /** income − expenses */
  net: number;
  /** Per-month averages over the months shown (at least 1, never ÷ 0). Unrounded. */
  avgSalary: number;
  avgSubsPersonal: number;
  avgSubsWork: number;
  avgSubsEssential: number;
  avgExpenses: number;
  avgNet: number;
}

export function totalsOf(months: MonthData[]): Totals {
  const sum = (f: (d: MonthData) => number) => months.reduce((s, d) => s + f(d), 0);
  const income = sum((d) => d.income);
  const salary = sum((d) => d.salary);
  const subscriptions = sum((d) => d.subscriptions);
  const subsPersonal = sum((d) => d.subsPersonal);
  const subsWork = sum((d) => d.subsWork);
  const subsEssential = sum((d) => d.subsEssential);
  const other = sum((d) => d.other);
  const otherWork = sum((d) => d.otherWork);
  const otherPersonal = sum((d) => d.otherPersonal);
  const expenses = sum((d) => d.salary + d.subscriptions + d.other);
  const net = income - expenses;
  const n = months.length || 1;
  return {
    income, salary, subscriptions, subsPersonal, subsWork, subsEssential,
    other, otherWork, otherPersonal, expenses, net,
    avgSalary: salary / n,
    avgSubsPersonal: subsPersonal / n,
    avgSubsWork: subsWork / n,
    avgSubsEssential: subsEssential / n,
    avgExpenses: expenses / n,
    avgNet: net / n,
  };
}

/** What each month plots: the dashboard chart and the corporate chart. */
export interface ChartPoint {
  month: string;
  income: number;
  expenses: number;
  /** salary + work subscriptions + work other expenses */
  workExpenses: number;
  personalExpenses: number;
  essentialExpenses: number;
  salary: number;
  workSubs: number;
  net: number;
  /** income − workExpenses, before any client is excluded */
  corporateNet: number;
}

export function chartPointsOf(months: MonthData[]): ChartPoint[] {
  return months.map((d) => {
    const expenses = d.salary + d.subscriptions + d.other;
    const workExpenses = d.salary + d.subsWork + d.otherWork;
    return {
      month: d.month,
      income: d.income,
      expenses,
      workExpenses,
      personalExpenses: d.subsPersonal + d.otherPersonal,
      essentialExpenses: d.subsEssential,
      salary: d.salary,
      workSubs: d.subsWork,
      net: d.income - expenses,
      corporateNet: d.income - workExpenses,
    };
  });
}

// ── Corporate profitability ─────────────────────────────────────────────────

/** How the corporate net is shared between the two partners. */
export const PARTNER_SPLIT = { a: 0.6, b: 0.4 } as const;

/**
 * Corporate points with some clients' income taken out, month by month.
 *
 * Only income moves: work expenses are the company's whatever the client, so
 * excluding a client lowers income and corporate net by exactly what that
 * client paid that month.
 */
export function excludeClients<P extends { month: string; income: number; workExpenses: number }>(
  points: P[],
  incomeByClient: MonthIncomeByClient[],
  excludedIds: Iterable<string>
): (P & { income: number; excludedIncome: number; corporateNet: number })[] {
  const excluded = [...excludedIds];
  const byMonth = new Map(incomeByClient.map((m) => [m.month, m.byClient]));
  return points.map((p) => {
    let excludedIncome = 0;
    const byClient = byMonth.get(p.month);
    if (byClient) for (const id of excluded) excludedIncome += byClient[id] ?? 0;
    const income = p.income - excludedIncome;
    return { ...p, income, excludedIncome, corporateNet: income - p.workExpenses };
  });
}

export interface Corporate {
  /** Paid income after excluded clients. */
  income: number;
  /** What the excluded clients paid in the period. */
  excludedIncome: number;
  workExpenses: number;
  /** income − workExpenses, accumulated over the period. */
  net: number;
  /** Rounded the way the dashboard shows them; they may differ from net by a cent. */
  partnerA: number;
  partnerB: number;
}

export function corporateOf(
  months: MonthData[],
  incomeByClient: MonthIncomeByClient[],
  excludedIds: Iterable<string>
): Corporate {
  const points = excludeClients(chartPointsOf(months), incomeByClient, excludedIds);
  const income = points.reduce((s, p) => s + p.income, 0);
  const excludedIncome = points.reduce((s, p) => s + p.excludedIncome, 0);
  const workExpenses = points.reduce((s, p) => s + p.workExpenses, 0);
  const net = points.reduce((s, p) => s + p.corporateNet, 0);
  return {
    income,
    excludedIncome,
    workExpenses,
    net,
    partnerA: Math.round(net * PARTNER_SPLIT.a),
    partnerB: Math.round(net * PARTNER_SPLIT.b),
  };
}

// ── Invoices awaiting payment ───────────────────────────────────────────────

/**
 * An invoice that was sent and whose due date has already gone by.
 *
 * Derived, never stored. Due dates are always a month's last day, so a Sent
 * invoice due Aug 31 is past due from Sep 1 (Montevideo) on — and never on the
 * due date itself. `today` is a UTC-midnight date as getTodayInTZ returns it.
 */
export function isPastDue(
  invoice: { status: string; due_date: Date | string },
  today: Date
): boolean {
  if (invoice.status !== "sent") return false;
  const due = typeof invoice.due_date === "string" ? new Date(invoice.due_date) : invoice.due_date;
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return dueDay < todayDay;
}

export interface Awaiting {
  count: number;
  /** Σ amount + fee — what the company will actually receive. */
  netCents: number;
  pastDueCount: number;
}

/** Invoices with status Sent: count, what they will bring in, how many are late. */
export function awaitingOf(
  sent: { status: string; amount_cents: number; fee_cents: number; due_date: Date }[],
  today: Date
): Awaiting {
  const onlySent = sent.filter((i) => i.status === "sent");
  return {
    count: onlySent.length,
    netCents: onlySent.reduce((s, i) => s + i.amount_cents + i.fee_cents, 0),
    pastDueCount: onlySent.filter((i) => isPastDue(i, today)).length,
  };
}

// ── Upcoming payments ───────────────────────────────────────────────────────

/** How far ahead "upcoming" looks, in days, today included. */
export const UPCOMING_DAYS = 5;

export interface UpcomingPayment {
  id: string;
  type: "subscription" | "salary";
  name: string;
  amount_cents: number;
  /** ISO string of the day it falls due. */
  due_date: string;
}

export interface SubscriptionForUpcoming {
  id: string;
  name: string;
  amount_cents: number;
  frequency: string;
  pay_day: number;
  pay_month: number | null;
  /** Due dates that already have a (non-deleted) payment. */
  paidDueDates: Date[];
}

export interface PersonForUpcoming {
  id: string;
  name: string;
  payday_day: number;
  base_salary_cents: number;
  paidDueDates: Date[];
}

/**
 * The first due date of each active subscription in the next few days, unless
 * it is already paid. A subscription only ever shows once.
 */
export function upcomingSubscriptions(
  subs: SubscriptionForUpcoming[],
  today: Date,
  days = UPCOMING_DAYS
): UpcomingPayment[] {
  return subs.flatMap((sub) => {
    const paid = new Set(sub.paidDueDates.map((d) => d.toISOString()));
    for (let i = 0; i <= days; i++) {
      const check = addDaysUTC(today, i);
      const y = check.getUTCFullYear();
      const m = check.getUTCMonth() + 1;
      const d = check.getUTCDate();
      const dayMatches = clampDay(y, m, sub.pay_day) === d;
      const isDue = sub.frequency === "monthly" ? dayMatches : sub.pay_month === m && dayMatches;
      if (!isDue) continue;
      const due = new Date(Date.UTC(y, m - 1, clampDay(y, m, sub.pay_day)));
      if (paid.has(due.toISOString())) return [];
      return [{
        id: sub.id,
        type: "subscription" as const,
        name: sub.name,
        amount_cents: sub.amount_cents,
        due_date: check.toISOString(),
      }];
    }
    return [];
  });
}

/** Same rule for salaries: the next payday in the window, unless it is paid. */
export function upcomingSalaries(
  people: PersonForUpcoming[],
  today: Date,
  days = UPCOMING_DAYS
): UpcomingPayment[] {
  return people.flatMap((person) => {
    const paid = new Set(person.paidDueDates.map((d) => d.toISOString()));
    for (let i = 0; i <= days; i++) {
      const check = addDaysUTC(today, i);
      const y = check.getUTCFullYear();
      const m = check.getUTCMonth() + 1;
      if (clampDay(y, m, person.payday_day) !== check.getUTCDate()) continue;
      const due = new Date(Date.UTC(y, m - 1, clampDay(y, m, person.payday_day)));
      if (paid.has(due.toISOString())) return [];
      return [{
        id: person.id,
        type: "salary" as const,
        name: person.name,
        amount_cents: person.base_salary_cents,
        due_date: check.toISOString(),
      }];
    }
    return [];
  });
}

/** Subscriptions and salaries together, soonest first. */
export function upcomingPaymentsOf(
  subs: SubscriptionForUpcoming[],
  people: PersonForUpcoming[],
  today: Date,
  days = UPCOMING_DAYS
): UpcomingPayment[] {
  return [...upcomingSubscriptions(subs, today, days), ...upcomingSalaries(people, today, days)].sort(
    (a, b) => a.due_date.localeCompare(b.due_date)
  );
}

// ── Work expenses by item (the corporate PDF's detail table) ────────────────

export interface WorkExpenseRow {
  id: string;
  name: string;
  monthly: Record<string, number>;
}

export interface WorkExpensesByItem {
  salaries: WorkExpenseRow[];
  workSubs: WorkExpenseRow[];
  workOther: WorkExpenseRow[];
}

/**
 * Each work cost, month by month: one row per person, per work subscription
 * and per work expense name. Other expenses have no stable identity across
 * entries, so rows with the same name are one item.
 */
export function workExpensesByItemOf(
  months: string[],
  rows: {
    salaries: (SalaryPaymentRow & { person_id: string; person_name: string })[];
    subscriptions: (SubscriptionPaymentRow & { subscription_id: string; subscription_name: string })[];
    others: (OtherExpenseRow & { name: string })[];
  }
): WorkExpensesByItem {
  const inRange = new Set(months);
  const add = (map: Map<string, WorkExpenseRow>, id: string, name: string, month: string, cents: number) => {
    let row = map.get(id);
    if (!row) {
      row = { id, name, monthly: Object.fromEntries(months.map((m) => [m, 0])) };
      map.set(id, row);
    }
    row.monthly[month] = (row.monthly[month] ?? 0) + cents;
  };
  const salaries = new Map<string, WorkExpenseRow>();
  const workSubs = new Map<string, WorkExpenseRow>();
  const workOther = new Map<string, WorkExpenseRow>();

  for (const p of rows.salaries) {
    const m = periodKeyOf(p.paid_at);
    if (inRange.has(m)) add(salaries, p.person_id, p.person_name, m, p.total_cents);
  }
  for (const p of rows.subscriptions) {
    if (p.category !== "work") continue;
    const m = periodKeyOf(p.paid_at);
    if (inRange.has(m)) add(workSubs, p.subscription_id, p.subscription_name, m, p.amount_cents_snapshot);
  }
  for (const p of rows.others) {
    if (p.category !== "work") continue;
    const m = periodKeyOf(p.paid_at);
    if (inRange.has(m)) add(workOther, p.name, p.name, m, p.amount_cents);
  }
  return {
    salaries: [...salaries.values()],
    workSubs: [...workSubs.values()],
    workOther: [...workOther.values()],
  };
}

// ── The report GET /api/metrics returns ─────────────────────────────────────

export type MetricsPeriod = "this_year" | "last_12_months";

export const PERIOD_PRESET: Record<MetricsPeriod, Preset> = {
  this_year: "ytd",
  last_12_months: "last12",
};

export interface MetricsReportInput {
  /** A preset over the loaded months, or one explicit month. */
  selection: { kind: MetricsPeriod } | { kind: "month"; month: string };
  months: string[];
  rows: MonthlyInputs;
  sent: { status: string; amount_cents: number; fee_cents: number; due_date: Date }[];
  upcoming: {
    payments: UpcomingPayment[];
    invoices: {
      id: string;
      invoice_number: string | null;
      client: { name: string; color_hex: string };
      amount_cents: number;
      fee_cents: number;
      status: string;
      due_date: string;
    }[];
  };
  excludedClients: { id: string; name: string; color_hex: string }[];
  today: Date;
}

/**
 * The whole Metrics payload, in integer cents. Same functions as the web
 * dashboard, so a number here is the number the dashboard shows for the same
 * period and the same saved exclusions.
 */
export function buildMetricsReport(input: MetricsReportInput) {
  const { monthly, incomeByClient } = bucketByMonth(input.months, input.rows);
  const shown =
    input.selection.kind === "month"
      ? monthly
      : filterMonths(monthly, PERIOD_PRESET[input.selection.kind], input.today);
  const shownKeys = new Set(shown.map((m) => m.month));
  const incomeShown = incomeByClient.filter((m) => shownKeys.has(m.month));

  const t = totalsOf(shown);
  const c = corporateOf(shown, incomeShown, input.excludedClients.map((x) => x.id));
  const a = awaitingOf(input.sent, input.today);

  return {
    period: { kind: input.selection.kind, months: shown.map((m) => m.month) },
    today: input.today.toISOString().slice(0, 10),
    awaiting_payment: {
      count: a.count,
      net_cents: a.netCents,
      past_due_count: a.pastDueCount,
    },
    income_cents: t.income,
    expenses: {
      salary_cents: t.salary,
      subscriptions_cents: t.subscriptions,
      subscriptions_work_cents: t.subsWork,
      subscriptions_personal_cents: t.subsPersonal,
      subscriptions_essential_cents: t.subsEssential,
      other_cents: t.other,
      other_work_cents: t.otherWork,
      other_personal_cents: t.otherPersonal,
      total_cents: t.expenses,
    },
    net_income_cents: t.net,
    monthly_averages: {
      months: shown.length,
      salary_cents: Math.round(t.avgSalary),
      subscriptions_personal_cents: Math.round(t.avgSubsPersonal),
      subscriptions_work_cents: Math.round(t.avgSubsWork),
      subscriptions_essential_cents: Math.round(t.avgSubsEssential),
      total_expense_cents: Math.round(t.avgExpenses),
      net_income_cents: Math.round(t.avgNet),
    },
    corporate: {
      income_cents: c.income,
      excluded_income_cents: c.excludedIncome,
      excluded_clients: input.excludedClients,
      work_expenses_cents: c.workExpenses,
      net_cents: c.net,
      partner_a_cents: c.partnerA,
      partner_b_cents: c.partnerB,
      split: { partner_a: PARTNER_SPLIT.a, partner_b: PARTNER_SPLIT.b },
    },
    upcoming: {
      days: UPCOMING_DAYS,
      payments: input.upcoming.payments,
      invoices: input.upcoming.invoices.map((inv) => ({
        ...inv,
        net_cents: inv.amount_cents + inv.fee_cents,
      })),
    },
  };
}

export type MetricsReport = ReturnType<typeof buildMetricsReport>;
