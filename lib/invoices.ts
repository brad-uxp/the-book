/**
 * Invoice rules the web and the phone must agree on.
 *
 * No imports, so the Android app can use it as it is (`@shared/invoices`):
 * lib/metrics pulls in date-fns through lib/dates, which the app does not
 * bundle. The dashboard, GET /api/metrics and the phone's Invoices tab all
 * count from these two functions.
 */

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

/** What an invoice actually brings in: its amount plus its (negative) referrer fee. */
export function invoiceNetCents(invoice: { amount_cents: number; fee_cents: number }): number {
  return invoice.amount_cents + invoice.fee_cents;
}

export interface Awaiting {
  count: number;
  /** Σ amount + fee — what the company will actually receive. */
  netCents: number;
  pastDueCount: number;
}

/** Invoices with status Sent: count, what they will bring in, how many are late. */
export function awaitingOf(
  sent: { status: string; amount_cents: number; fee_cents: number; due_date: Date | string }[],
  today: Date
): Awaiting {
  const onlySent = sent.filter((i) => i.status === "sent");
  return {
    count: onlySent.length,
    netCents: onlySent.reduce((s, i) => s + invoiceNetCents(i), 0),
    pastDueCount: onlySent.filter((i) => isPastDue(i, today)).length,
  };
}
