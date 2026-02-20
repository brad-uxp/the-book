/**
 * Currency utilities — all amounts stored as integer cents (USD).
 */

/** Format cents as USD string, e.g. 1050 → "$10.50" */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Parse a dollar string into cents, e.g. "10.50" → 1050 */
export function parseToCents(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

/** Convert cents to a decimal string for input fields, e.g. 1050 → "10.50" */
export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}
