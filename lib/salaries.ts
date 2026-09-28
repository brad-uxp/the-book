/**
 * Salary rules for the web's salaries table. The phone's report
 * (mobile/src/business/salaries.ts) applies the same rule; no imports here,
 * so it can move to `@shared` if the two ever need to share code.
 */

/**
 * Whether a person was paid for a month ("YYYY-MM").
 *
 * A payment counts for the month of its `due_date`, which is stored as UTC
 * midnight — so the month is read straight off the ISO string, never through
 * a local timezone (in Montevideo, UTC-3, the 1st at 00:00 UTC is still the
 * previous month's last evening).
 *
 * Any payment for that month counts, not only the latest one: a payment
 * registered ahead for next month must not hide this month's.
 */
export function wasPaidForMonth(
  payments: readonly { due_date: string }[],
  month: string
): boolean {
  return payments.some((p) => p.due_date.slice(0, 7) === month);
}
