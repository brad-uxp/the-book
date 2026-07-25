/**
 * Shared helpers for the daily cron job logic.
 * These are pure functions, testable without a database.
 */
import {
  calcMonthlyDueDate,
  calcAnnualDueDate,
  isSameDay,
  addDaysUTC,
} from "./dates";
import { formatCents } from "./currency";
import type { NotificationType } from "@/app/generated/prisma/enums";

export interface SubscriptionForCron {
  id: string;
  name: string;
  amount_cents: number;
  frequency: "monthly" | "annual";
  pay_day: number;
  pay_month: number | null;
  payment_mode: "auto" | "manual";
  status: "active" | "inactive";
}

export interface CronPeriodResult {
  /** Due date of the period that contains `today` — the one `isToday` refers to. */
  dueDate: Date;
  /** Due date the advance notice refers to — may be in the NEXT month or year. */
  upcomingDueDate: Date;
  isToday: boolean;
  isDaysBefore: boolean;
}

/** Due date of the period containing `ref`, with day-clamping applied. */
function dueDateForPeriodOf(sub: SubscriptionForCron, ref: Date): Date {
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth() + 1;

  if (sub.frequency === "monthly") {
    return calcMonthlyDueDate(year, month, sub.pay_day);
  }
  const payMonth = sub.pay_month ?? 1; // fallback; UI validates this
  return calcAnnualDueDate(year, payMonth, sub.pay_day);
}

/**
 * Advance-notice check for anything that recurs on a day-of-month.
 *
 * Looks FORWARD from today instead of backward from this month's due date.
 * Going backward breaks whenever `dayOfMonth <= daysBefore`: the notify date
 * lands in the previous month while `today` is in the current one, so it never
 * matches and the notice is silently never sent.
 */
export function advanceNotice(
  today: Date,
  daysBefore: number,
  dayOfMonth: number
): { hit: boolean; dueDate: Date } {
  const candidate = addDaysUTC(today, daysBefore);
  const dueDate = calcMonthlyDueDate(
    candidate.getUTCFullYear(),
    candidate.getUTCMonth() + 1,
    dayOfMonth
  );
  return { hit: isSameDay(candidate, dueDate), dueDate };
}

/**
 * Given a subscription and today's date, compute the current period's due_date
 * and determine whether today is the due date and/or the advance-notice day.
 *
 * `isDaysBefore` looks forward from today (see `advanceNotice`), so it fires
 * exactly once per period regardless of how `pay_day` and `daysBefore` compare.
 *
 * Note: with `daysBefore === 0` both flags are true on the due date — they
 * describe the same day. Callers that emit a notification for each must not
 * emit both (see runSubscriptions).
 */
export function getSubscriptionPeriod(
  sub: SubscriptionForCron,
  today: Date,
  daysBefore = 2
): CronPeriodResult {
  const dueDate = dueDateForPeriodOf(sub, today);

  const candidate = addDaysUTC(today, daysBefore);
  const upcomingDueDate = dueDateForPeriodOf(sub, candidate);

  return {
    dueDate,
    upcomingDueDate,
    isToday: isSameDay(today, dueDate),
    isDaysBefore: isSameDay(candidate, upcomingDueDate),
  };
}

export type SubscriptionEvent =
  | { kind: "auto_upcoming"; dueDate: Date }
  | { kind: "auto_charge"; dueDate: Date }
  | { kind: "manual_due"; dueDate: Date };

/**
 * Decides which events a subscription produces today. Pure on purpose: this is
 * the rule the cron enforces, and keeping it out of `run-daily.ts` (which needs
 * a database) is what makes it testable.
 */
export function subscriptionEvents(
  sub: SubscriptionForCron,
  today: Date,
  daysBefore: number
): SubscriptionEvent[] {
  const { dueDate, upcomingDueDate, isToday, isDaysBefore } =
    getSubscriptionPeriod(sub, today, daysBefore);
  const events: SubscriptionEvent[] = [];

  if (sub.payment_mode === "auto") {
    // With daysBefore === 0 the advance notice falls on the due date, where the
    // charge notification already fires — one event, not two.
    if (isDaysBefore && !isToday) {
      events.push({ kind: "auto_upcoming", dueDate: upcomingDueDate });
    }
    if (isToday) {
      events.push({ kind: "auto_charge", dueDate });
    }
  } else if (isDaysBefore) {
    // The only notification a manual subscription ever gets.
    events.push({ kind: "manual_due", dueDate: upcomingDueDate });
  }

  return events;
}

/**
 * Build notification payloads for subscription cron events.
 */
export function buildSubscriptionNotification(params: {
  type: Extract<
    NotificationType,
    | "subscription_auto_upcoming"
    | "subscription_manual_due"
    | "subscription_auto_paid"
  >;
  sub: SubscriptionForCron;
  dueDate: Date;
  eventDate: Date;
  daysBefore?: number;
}): {
  type: NotificationType;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  event_date: Date;
} {
  const { type, sub, eventDate, daysBefore = 2 } = params;
  const amount = formatCents(sub.amount_cents);
  // `daysBefore === 0` means the notice lands on the due date itself; saying
  // "in 0 days" reads as a bug to whoever gets the push.
  const when = daysBefore === 0
    ? "today"
    : `in ${daysBefore} day${daysBefore !== 1 ? "s" : ""}`;
  const dueLabel = daysBefore === 0 ? "due today" : `due ${when}`;
  const titles: Record<typeof type, string> = {
    subscription_auto_upcoming: `Upcoming auto payment: ${sub.name}`,
    subscription_manual_due: `Payment ${dueLabel}: ${sub.name}`,
    subscription_auto_paid: `Auto payment processed: ${sub.name}`,
  };
  const bodies: Record<typeof type, string> = {
    subscription_auto_upcoming: `Auto payment of ${amount} will be charged ${when}.`,
    subscription_manual_due: `Manual payment of ${amount} is ${dueLabel}.`,
    subscription_auto_paid: `${amount} was automatically charged today.`,
  };
  return {
    type,
    title: titles[type],
    body: bodies[type],
    entity_type: "subscription",
    entity_id: sub.id,
    event_date: eventDate,
  };
}
