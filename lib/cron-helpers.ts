/**
 * Shared helpers for the daily cron job logic.
 * These are pure functions, testable without a database.
 */
import {
  calcMonthlyDueDate,
  calcAnnualDueDate,
  monthlyPeriodKey,
  annualPeriodKey,
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
  status: "active" | "paused" | "canceled";
}

export interface CronPeriodResult {
  periodKey: string;
  dueDate: Date;
  isToday: boolean;
  isTwoDaysBefore: boolean;
}

/**
 * Given a subscription and today's date, compute the current period's
 * due_date and period_key, then determine if today matches.
 */
export function getSubscriptionPeriod(
  sub: SubscriptionForCron,
  today: Date
): CronPeriodResult {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  let dueDate: Date;
  let periodKey: string;

  if (sub.frequency === "monthly") {
    dueDate = calcMonthlyDueDate(year, month, sub.pay_day);
    periodKey = monthlyPeriodKey(year, month);
  } else {
    // annual
    const payMonth = sub.pay_month ?? 1; // fallback; UI validates this
    dueDate = calcAnnualDueDate(year, payMonth, sub.pay_day);
    periodKey = annualPeriodKey(year);
  }

  const twoDaysBefore = addDaysUTC(dueDate, -2);

  return {
    periodKey,
    dueDate,
    isToday: isSameDay(today, dueDate),
    isTwoDaysBefore: isSameDay(today, twoDaysBefore),
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
}): {
  type: NotificationType;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  event_date: Date;
} {
  const { type, sub, eventDate } = params;
  const titles: Record<typeof type, string> = {
    subscription_auto_upcoming: `Upcoming auto payment: ${sub.name}`,
    subscription_manual_due: `Payment due: ${sub.name}`,
    subscription_auto_paid: `Auto payment processed: ${sub.name}`,
  };
  const bodies: Record<typeof type, string> = {
    subscription_auto_upcoming: `Auto payment of $${(sub.amount_cents / 100).toFixed(2)} will be charged in 2 days.`,
    subscription_manual_due: `Manual payment of $${(sub.amount_cents / 100).toFixed(2)} is due today.`,
    subscription_auto_paid: `$${(sub.amount_cents / 100).toFixed(2)} was automatically charged today.`,
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
