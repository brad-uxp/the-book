/**
 * Currency utilities — all amounts stored as integer cents (USD).
 */

/** Format cents as USD string, e.g. 1050 → "$10.50" */
export function formatCents(cents: number): string {
  // Defensive: nothing should ever hold fractional cents, but if a float slips
  // in from an unvalidated payload, round it rather than render a third decimal.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.round(cents) / 100);
}

/**
 * Split a normalized numeric string into its group/decimal parts.
 *
 * Accepts both US (`1,234.56`) and European (`1.234,56`) notation: when both
 * separators appear, the LAST one is the decimal separator. When only one
 * appears, it is a decimal separator unless it groups digits in exact
 * thousands (`1,234` / `1.234`), which is unambiguous grouping.
 *
 * Returns null when the input is not a well-formed amount — the caller turns
 * that into 0 rather than guessing a number out of malformed text.
 */
function splitAmount(s: string): { int: string; frac: string } | null {
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let decimalSep = "";
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0) {
    // Lone comma: grouping only if it splits into exact thousands ("1,234"),
    // otherwise it is the decimal separator ("1,50").
    const parts = s.split(",");
    const isGrouping = parts.slice(1).every((p) => /^\d{3}$/.test(p));
    decimalSep = isGrouping ? "" : ",";
  } else if (lastDot >= 0) {
    // A lone dot is ALWAYS the decimal separator. "1.005" is genuinely
    // ambiguous (1005 grouped, or 1.005 decimal), and every amount this app
    // renders — centsToDecimalString, formatCents — uses the dot as decimal,
    // so that is the reading that round-trips its own output.
    decimalSep = ".";
  }

  const groupSep = decimalSep === "," ? "." : ",";

  let intPart: string;
  let fracPart = "";
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
    if (!/^\d*$/.test(fracPart)) return null;
  } else {
    intPart = s;
  }

  // Group separators may only sit between digit groups of exactly three.
  if (intPart.includes(groupSep)) {
    const groups = intPart.split(groupSep);
    const head = groups.shift() ?? "";
    if (!/^\d{1,3}$/.test(head)) return null;
    if (!groups.every((g) => /^\d{3}$/.test(g))) return null;
    intPart = head + groups.join("");
  }

  if (!/^\d*$/.test(intPart)) return null;
  if (intPart === "" && fracPart === "") return null;

  return { int: intPart || "0", frac: fracPart };
}

/**
 * Parse a dollar string into integer cents, e.g. "10.50" → 1050.
 *
 * Rounds on the decimal string rather than via `value * 100`: the float path
 * turns "1.005" into 100.49999999999999 and silently loses a cent.
 * Malformed input returns 0 — never a partially-parsed amount.
 */
export function parseToCents(value: string): number {
  if (typeof value !== "string") return 0;

  let s = value.trim();
  if (!s) return 0;

  // Currency symbols, spaces (incl. non-breaking) and thin separators.
  s = s.replace(/[$  \s]/g, "");

  let negative = false;
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = true;
    s = s.slice(1);
  }
  if (!s || !/^[\d.,]+$/.test(s)) return 0;

  const parts = splitAmount(s);
  if (!parts) return 0;

  const whole = parts.int === "" ? 0 : Number(parts.int);
  if (!Number.isSafeInteger(whole)) return 0;

  // Pad/truncate the fraction to 3 digits: two for cents, one to round on.
  // All arithmetic below is on integers, so it is exact — the drift in the old
  // implementation came from multiplying the *fractional* value by 100.
  const frac3 = (parts.frac + "000").slice(0, 3);
  let cents = whole * 100 + Number(frac3.slice(0, 2));
  if (Number(frac3[2]) >= 5) cents += 1;

  if (!Number.isSafeInteger(cents)) return 0;
  return negative ? -cents : cents;
}

/** Convert cents to a decimal string for input fields, e.g. 1050 → "10.50" */
export function centsToDecimalString(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}
