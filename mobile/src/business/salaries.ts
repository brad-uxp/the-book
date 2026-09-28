import { montevideoToday } from "../lib/format.ts";

/**
 * The Salaries tab: GET /api/people (each person with their base salary and
 * last twelve payments) turned into one month's report — who was paid, who
 * wasn't, and what that adds up to.
 *
 * The rules are the web's:
 * - a payment counts for the month of its `due_date`, which the server
 *   derives from the day it was paid and the person's payday (clamped to the
 *   month's length) — see POST /api/people/:id/payments;
 * - only active people are expected to be paid; what someone unpaid is owed
 *   is their current base salary.
 * One difference: the web asks "is the LATEST payment from this month?", which
 * a payment registered ahead for next month would flip; here the question is
 * "is there a payment for this month?", which also works for past months.
 *
 * Pure (relative imports with the extension), so it runs under `node --test`.
 */

export interface SalaryPayment {
  id: string;
  /** YYYY-MM-DD: the person's payday in the month it pays for. */
  due_date: string;
  /** YYYY-MM-DD. */
  paid_at: string;
  total_cents: number;
  adjustment_cents: number;
  adjustment_note: string | null;
}

export interface PersonItem {
  id: string;
  name: string;
  role: string | null;
  status: "active" | "inactive";
  /** 1–31. */
  payday_day: number;
  base_salary_cents: number;
  /** YYYY-MM-DD. */
  created_at: string;
  payments: SalaryPayment[];
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function int(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
}

function toPayment(raw: unknown): SalaryPayment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const due = str(r.due_date);
  const paid = str(r.paid_at);
  if (!id || !due || !paid) return null;
  return {
    id,
    due_date: due.slice(0, 10),
    paid_at: paid.slice(0, 10),
    total_cents: int(r.total_cents),
    adjustment_cents: int(r.adjustment_cents),
    adjustment_note: str(r.adjustment_note),
  };
}

function toPerson(raw: unknown): PersonItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name);
  if (!id || !name) return null;
  const role = (r.role ?? null) as Record<string, unknown> | null;
  const base = (r.salary_base ?? null) as Record<string, unknown> | null;
  const payments = Array.isArray(r.salary_payments) ? r.salary_payments : [];
  return {
    id,
    name,
    role: role ? str(role.name) : null,
    status: r.status === "inactive" ? "inactive" : "active",
    payday_day: Math.min(31, Math.max(1, int(r.payday_day) || 1)),
    base_salary_cents: base ? int(base.base_salary_cents) : 0,
    created_at: (str(r.created_at) ?? "1970-01-01").slice(0, 10),
    payments: payments.map(toPayment).filter((p): p is SalaryPayment => p !== null),
  };
}

/** GET /api/people, cut down to what the report needs. */
export function toPeople(raw: unknown): PersonItem[] {
  if (!Array.isArray(raw)) throw new Error("Unexpected answer from the server");
  return raw.map(toPerson).filter((p): p is PersonItem => p !== null);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A person's payday in a month, clamped to its length (31 in February → 28/29). */
export function paydayIn(month: string, paydayDay: number): string {
  const [y, m] = month.split("-").map(Number);
  const day = Math.min(paydayDay, daysInMonth(y, m));
  return `${month}-${String(day).padStart(2, "0")}`;
}

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface PaidLine {
  person: PersonItem;
  payment: SalaryPayment;
}

export interface UnpaidLine {
  person: PersonItem;
  /** Their payday in this month. */
  due: string;
  /** Days since that payday, 0 when it has not come yet. */
  daysLate: number;
  /** What they are owed: the current base salary. */
  amount_cents: number;
}

export interface MonthReport {
  month: string;
  paid: PaidLine[];
  unpaid: UnpaidLine[];
  paidCents: number;
  unpaidCents: number;
  /** People counted in this month: paid plus unpaid. */
  people: number;
}

/**
 * One month: everyone active who was already with the team by its end, plus
 * anyone paid for it (even if no longer active). `today` is Montevideo's
 * YYYY-MM-DD.
 */
export function monthReport(people: PersonItem[], month: string, today: string): MonthReport {
  const end = lastDayOf(month);
  const paid: PaidLine[] = [];
  const unpaid: UnpaidLine[] = [];

  for (const person of people) {
    const payment = person.payments.find((p) => p.due_date.slice(0, 7) === month);
    if (payment) {
      paid.push({ person, payment });
      continue;
    }
    if (person.status !== "active" || person.created_at > end) continue;
    const due = paydayIn(month, person.payday_day);
    unpaid.push({
      person,
      due,
      daysLate: Math.max(0, daysBetween(due, today)),
      amount_cents: person.base_salary_cents,
    });
  }

  unpaid.sort((a, b) => a.due.localeCompare(b.due) || a.person.name.localeCompare(b.person.name));
  paid.sort((a, b) => a.person.name.localeCompare(b.person.name));

  return {
    month,
    paid,
    unpaid,
    paidCents: paid.reduce((s, l) => s + l.payment.total_cents, 0),
    unpaidCents: unpaid.reduce((s, l) => s + l.amount_cents, 0),
    people: paid.length + unpaid.length,
  };
}

/**
 * The day a payment is registered with, by default: today for this month;
 * for a past month, the person's payday in it — any day of that month makes
 * the server file the payment under it.
 */
export function defaultPaidAt(month: string, today: string, paydayDay: number): string {
  if (month === today.slice(0, 7)) return today;
  return paydayIn(month, paydayDay);
}

/** Months the tab can show: this one and the eleven before it (the API returns 12 payments a person). */
export const MONTHS_BACK = 11;

export function thisMonth(now: Date): string {
  return montevideoToday(now).slice(0, 7);
}
