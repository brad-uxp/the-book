import { prisma } from "@/lib/db";
import { addDaysUTC } from "@/lib/dates";
import {
  monthRange,
  upcomingPaymentsOf,
  UPCOMING_DAYS,
  type OtherExpenseRow,
  type PaidInvoiceRow,
  type SalaryPaymentRow,
  type SubscriptionPaymentRow,
  type UpcomingPayment,
} from "@/lib/metrics";

/**
 * The database side of lib/metrics.ts: the queries, and nothing else. Both the
 * dashboard page and GET /api/metrics load through here so they read exactly
 * the same rows.
 */

/** Paid invoices, payments and expenses that fall inside the given months. */
export async function loadMonthlyRows(months: string[]) {
  const { from, to } = monthRange(months);
  const [subPayments, salaryPayments, invoices, otherExpenses] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { deleted_at: null, paid_at: { gte: from, lte: to } },
      select: {
        paid_at: true,
        amount_cents_snapshot: true,
        subscription: { select: { id: true, name: true, category: true } },
      },
    }),
    prisma.salaryPayment.findMany({
      where: { paid_at: { gte: from, lte: to } },
      select: { paid_at: true, total_cents: true, person_id: true, person: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      where: { status: "paid", due_date: { gte: from, lte: to } },
      select: {
        due_date: true,
        amount_cents: true,
        fee_cents: true,
        client_id: true,
        client: { select: { name: true, color_hex: true } },
      },
    }),
    prisma.otherExpense.findMany({
      where: { paid_at: { gte: from, lte: to } },
      select: { paid_at: true, amount_cents: true, category: true, name: true },
    }),
  ]);

  const clientsIndex: Record<string, { name: string; color: string }> = {};
  for (const inv of invoices) {
    clientsIndex[inv.client_id] ??= { name: inv.client.name, color: inv.client.color_hex };
  }

  return {
    invoices: invoices as PaidInvoiceRow[],
    salaries: salaryPayments.map((p) => ({
      paid_at: p.paid_at,
      total_cents: p.total_cents,
      person_id: p.person_id,
      person_name: p.person.name,
    })) satisfies SalaryPaymentRow[],
    subscriptions: subPayments.map((p) => ({
      paid_at: p.paid_at,
      amount_cents_snapshot: p.amount_cents_snapshot,
      category: p.subscription.category,
      subscription_id: p.subscription.id,
      subscription_name: p.subscription.name,
    })) satisfies SubscriptionPaymentRow[],
    others: otherExpenses satisfies OtherExpenseRow[],
    clientsIndex,
  };
}

/** Every invoice in status Sent — the ones awaiting payment. */
export async function loadSentInvoices() {
  return prisma.invoice.findMany({
    where: { status: "sent" },
    select: { status: true, amount_cents: true, fee_cents: true, due_date: true },
  });
}

/**
 * Subscriptions and salaries falling due in the next few days that have no
 * payment yet, and invoices not yet paid that fall due in the same window.
 */
export async function loadUpcoming(today: Date, days = UPCOMING_DAYS) {
  const end = addDaysUTC(today, days);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // End of NEXT month: a window near month end reaches into it.
  const endOfNextMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

  const [subs, people, invoices] = await Promise.all([
    prisma.subscription.findMany({
      where: { status: "active" },
      select: {
        id: true, name: true, amount_cents: true, frequency: true, pay_day: true, pay_month: true,
        payments: {
          where: { deleted_at: null, due_date: { gte: startOfYear, lte: endOfNextMonth } },
          select: { due_date: true },
        },
      },
    }),
    prisma.person.findMany({
      where: { status: "active" },
      select: {
        id: true, name: true, payday_day: true,
        salary_base: { select: { base_salary_cents: true } },
        salary_payments: {
          where: { due_date: { gte: startOfMonth, lte: endOfNextMonth } },
          select: { due_date: true },
        },
      },
    }),
    prisma.invoice.findMany({
      where: { status: { not: "paid" }, due_date: { gte: today, lte: end } },
      include: { client: true },
      orderBy: { due_date: "asc" },
    }),
  ]);

  const payments: UpcomingPayment[] = upcomingPaymentsOf(
    subs.map((s) => ({
      id: s.id,
      name: s.name,
      amount_cents: s.amount_cents,
      frequency: s.frequency,
      pay_day: s.pay_day,
      pay_month: s.pay_month,
      paidDueDates: s.payments.map((p) => p.due_date),
    })),
    people.map((p) => ({
      id: p.id,
      name: p.name,
      payday_day: p.payday_day,
      base_salary_cents: p.salary_base?.base_salary_cents ?? 0,
      paidDueDates: p.salary_payments.map((x) => x.due_date),
    })),
    today,
    days
  );

  return {
    payments,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      client: { name: inv.client.name, color_hex: inv.client.color_hex },
      amount_cents: inv.amount_cents,
      fee_cents: inv.fee_cents,
      status: inv.status,
      due_date: inv.due_date.toISOString(),
    })),
  };
}
