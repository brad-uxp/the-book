/**
 * Dates as the app shows them. Pure and dependency-free, so it runs under
 * `node --test` and in Hermes alike.
 *
 * book.'s timezone is America/Montevideo. Uruguay has had no daylight saving
 * since 2015, so it is a fixed UTC−3 — no tz database needed on the phone.
 */

const MONTEVIDEO_OFFSET_MS = -3 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
