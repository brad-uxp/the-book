/**
 * Dates as the app shows them. Pure and dependency-free, so it runs under
 * `node --test` and in Hermes alike.
 *
 * book.'s timezone is America/Montevideo. Uruguay has had no daylight saving
 * since 2015, so it is a fixed UTC−3 — no tz database needed on the phone.
 */

const MONTEVIDEO_OFFSET_MS = -3 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Today's date in Montevideo, as YYYY-MM-DD. */
export function montevideoToday(now: Date): string {
  return new Date(now.getTime() + MONTEVIDEO_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function shortDate(ymd: string, withYearFrom?: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return withYearFrom && withYearFrom.slice(0, 4) !== ymd.slice(0, 4) ? `${base}, ${y}` : base;
}

export type DueTone = "overdue" | "soon" | "normal";

/**
 * A task's due date, as the list shows it. Due dates are stored at UTC
 * midnight, so the date part of the ISO string IS the due day. "Soon" is
 * within three days, the same threshold the web uses.
 */
export function dueLabel(dueIso: string, now: Date): { text: string; tone: DueTone } {
  const due = dueIso.slice(0, 10);
  const today = montevideoToday(now);
  const days = daysBetween(today, due);
  if (days < 0) return { text: `Overdue · ${shortDate(due, today)}`, tone: "overdue" };
  if (days === 0) return { text: "Today", tone: "soon" };
  if (days === 1) return { text: "Tomorrow", tone: "soon" };
  return { text: shortDate(due, today), tone: days < 3 ? "soon" : "normal" };
}

/** "now", "5m", "2h", "3d", then a date — how long ago something was edited. */
export function relativeTime(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const then = new Date(Date.parse(iso) + MONTEVIDEO_OFFSET_MS).toISOString().slice(0, 10);
  return shortDate(then, montevideoToday(now));
}

// ─── Months and days (Invoices, Salaries, Metrics) ───────────────────────────

/** "YYYY-MM" of a Montevideo day. */
export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

/** "YYYY-MM" plus or minus whole months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "September 2026". */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "Sep 2026". */
export function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * A stored day — an ISO string at UTC midnight, or YYYY-MM-DD — as "Sep 30",
 * with the year when it is not this year's.
 */
export function dayLabel(dayIso: string, now: Date): string {
  return shortDate(dayIso.slice(0, 10), montevideoToday(now));
}

/** 1 → "1st", 22 → "22nd", 25 → "25th". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "Updated just now", "Updated 5m ago", "Updated Sep 12" — when a screen's data was fetched. */
export function fetchedLabel(fetchedAtIso: string, now: Date): string {
  const ago = relativeTime(fetchedAtIso, now);
  if (ago === "now") return "Updated just now";
  return /^\d/.test(ago) ? `Updated ${ago} ago` : `Updated ${ago}`;
}

