import { toZonedTime } from "date-fns-tz";
import {
  format,
  addDays,
  getDaysInMonth,
  startOfMonth,
  endOfMonth,
  subMonths,
} from "date-fns";

export const TZ = "America/Montevideo";

/** Returns the current Date object in the Montevideo timezone. */
export function getNowInTZ(): Date {
  return toZonedTime(new Date(), TZ);
}

/** Returns today's date (midnight UTC) as seen from Montevideo. */
export function getTodayInTZ(): Date {
  const now = getNowInTZ();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  );
}

/**
 * Clamp a pay_day to the last valid day of the given month.
 * e.g., pay_day=31 in February → 28 (or 29 in a leap year)
 */
export function clampDay(year: number, month: number, day: number): number {
  const maxDay = getDaysInMonth(new Date(year, month - 1));
  return Math.min(day, maxDay);
}

/**
 * Calculate the due_date for a MONTHLY subscription given its pay_day.
 * Uses the current month in Montevideo timezone.
 */
export function calcMonthlyDueDate(
  year: number,
  month: number,
  payDay: number
): Date {
  const day = clampDay(year, month, payDay);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Calculate the due_date for an ANNUAL subscription given pay_month and pay_day.
 * Uses the current year in Montevideo timezone.
 */
export function calcAnnualDueDate(
  year: number,
  payMonth: number,
  payDay: number
): Date {
  const day = clampDay(year, payMonth, payDay);
  return new Date(Date.UTC(year, payMonth - 1, day));
}

/**
 * Generate period_key for a monthly subscription: "YYYY-MM"
 */
export function monthlyPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Generate period_key for an annual subscription: "YYYY"
 */
export function annualPeriodKey(year: number): string {
  return String(year);
}

/**
 * Format a date for display.
 * Dates are stored as UTC midnight "date-only" values, so we read the UTC
 * components directly to avoid the Montevideo (UTC-3) offset shifting the day.
 */
export function formatDate(date: Date | string): string {
  const str = typeof date === "string" ? date : date.toISOString();
  const [year, month, day] = str.slice(0, 10).split("-").map(Number);
  return format(new Date(year, month - 1, day), "dd/MM/yyyy");
}

/**
 * Format a date with month name for display.
 */
export function formatDateLong(date: Date | string): string {
  const str = typeof date === "string" ? date : date.toISOString();
  const [year, month, day] = str.slice(0, 10).split("-").map(Number);
  return format(new Date(year, month - 1, day), "d 'de' MMMM yyyy");
}

/**
 * Format a month period key "YYYY-MM" for display → "Feb 2026"
 */
export function formatPeriodKey(periodKey: string): string {
  if (periodKey.length === 4) {
    return periodKey; // Annual: just the year
  }
  const [year, month] = periodKey.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return format(d, "MMM yyyy");
}

/**
 * Returns an array of {year, month} for the last N months (including current).
 */
export function lastNMonths(
  n: number,
  from?: Date
): { year: number; month: number; periodKey: string }[] {
  const base = from ?? getNowInTZ();
  const result = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = subMonths(new Date(base.getFullYear(), base.getMonth(), 1), i);
    result.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      periodKey: monthlyPeriodKey(d.getFullYear(), d.getMonth() + 1),
    });
  }
  return result;
}

/** Check if two Date objects refer to the same calendar day (UTC). */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Add N days to a date. */
export function addDaysUTC(date: Date, n: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + n)
  );
}
