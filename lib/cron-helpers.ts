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
  dueDate: Date;
  isToday: boolean;
  isDaysBefore: boolean;
}

/**
 * Given a subscription and today's date, compute the current period's
 * due_date and period_key, then determine if today matches.
 * daysBefore controls how many days ahead to fire the "upcoming" notification.
 */
export function getSubscriptionPeriod(
  sub: SubscriptionForCron,
  today: Date,
  daysBefore = 2
): CronPeriodResult {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  let dueDate: Date;

  if (sub.frequency === "monthly") {
    dueDate = calcMonthlyDueDate(year, month, sub.pay_day);
  } else {
    // annual
    const payMonth = sub.pay_month ?? 1; // fallback; UI validates this
    dueDate = calcAnnualDueDate(year, payMonth, sub.pay_day);
  }

  const notifyDate = addDaysUTC(dueDate, -daysBefore);

  return {
    dueDate,
    isToday: isSameDay(today, dueDate),
    isDaysBefore: isSameDay(today, notifyDate),
  };
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
  const amount = `$${(sub.amount_cents / 100).toFixed(2)}`;
  const titles: Record<typeof type, string> = {
    subscription_auto_upcoming: `Upcoming auto payment: ${sub.name}`,
    subscription_manual_due: `Payment due in ${daysBefore} day${daysBefore !== 1 ? "s" : ""}: ${sub.name}`,
    subscription_auto_paid: `Auto payment processed: ${sub.name}`,
  };
  const bodies: Record<typeof type, string> = {
    subscription_auto_upcoming: `Auto payment of ${amount} will be charged in ${daysBefore} day${daysBefore !== 1 ? "s" : ""}.`,
    subscription_manual_due: `Manual payment of ${amount} is due in ${daysBefore} day${daysBefore !== 1 ? "s" : ""}.`,
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
