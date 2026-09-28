import { awaitingOf, invoiceNetCents, isPastDue, type Awaiting } from "../../../lib/invoices.ts";
import { montevideoToday } from "../lib/format.ts";

/**
 * The Invoices tab's data: GET /api/invoices, cut down to what the phone
 * shows. The past-due rule and the "awaiting payment" total come from
 * lib/invoices — the functions the web dashboard counts with — so the tab
 * and the dashboard can never disagree.
 *
 * Pure (relative imports with the extension), so it runs under `node --test`.
 */

export type InvoiceStatus = "pending" | "accounting" | "sent" | "paid";

export const STATUSES: readonly InvoiceStatus[] = ["pending", "accounting", "sent", "paid"];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: "Pending",
  accounting: "Accounting",
  sent: "Sent",
  paid: "Paid",
};

/** The web's badge colours (gray, orange, blue, green). */
export const INVOICE_STATUS_COLOR: Record<InvoiceStatus, string> = {
  pending: "#94A3B8",
  accounting: "#F97316",
  sent: "#3B82F6",
  paid: "#10B981",
};

export interface InvoiceItem {
  id: string;
  invoice_number: string | null;
  client: { id: string; name: string; color_hex: string };
  referrer: { name: string; color_hex: string } | null;
  amount_cents: number;
  /** The referrer's commission, stored negative. */
  fee_cents: number;
  /** amount + fee: what it brings in. */
  net_cents: number;
  status: InvoiceStatus;
  /** ISO, always a month's last day at UTC midnight. */
  due_date: string;
  notes: string | null;
  /** A PDF is attached (in R2 or as a link) — the key itself never leaves the server. */
  has_file: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function int(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
}

/** One invoice from the API, or null if it is not one. */
export function toInvoiceItem(raw: unknown): InvoiceItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const status = str(r.status) as InvoiceStatus | null;
  const due = str(r.due_date);
  const client = (r.client ?? null) as Record<string, unknown> | null;
  if (!id || !status || !STATUSES.includes(status) || !due || !client) return null;
  const referrer = (r.referrer ?? null) as Record<string, unknown> | null;
  const amount = int(r.amount_cents);
  const fee = int(r.fee_cents);
  return {
    id,
    invoice_number: str(r.invoice_number),
    client: {
      id: str(client.id) ?? "",
      name: str(client.name) ?? "Unknown client",
      color_hex: str(client.color_hex) ?? "#6366F1",
    },
    referrer: referrer ? { name: str(referrer.name) ?? "Referrer", color_hex: str(referrer.color_hex) ?? "#6366F1" } : null,
    amount_cents: amount,
    fee_cents: fee,
    net_cents: invoiceNetCents({ amount_cents: amount, fee_cents: fee }),
    status,
    due_date: due,
    notes: str(r.notes),
    has_file: Boolean(str(r.file_key) || str(r.file_url)),
  };
}

/** The whole list from GET /api/invoices; anything malformed is left out. */
export function toInvoiceItems(raw: unknown): InvoiceItem[] {
  if (!Array.isArray(raw)) throw new Error("Unexpected answer from the server");
  return raw.map(toInvoiceItem).filter((i): i is InvoiceItem => i !== null);
}

/** Today in Montevideo as a UTC-midnight Date — what isPastDue compares with. */
export function todayAsUtcDate(now: Date): Date {
  return new Date(`${montevideoToday(now)}T00:00:00.000Z`);
}

export function invoicePastDue(inv: InvoiceItem, now: Date): boolean {
  return isPastDue(inv, todayAsUtcDate(now));
}

/**
 * The tab's filters, as approved in the prototype: Awaiting = Sent (what the
 * dashboard calls awaiting payment), In prep = Pending + Accounting (not sent
 * yet), Paid, and All.
 */
export type Segment = "awaiting" | "prep" | "paid" | "all";

export const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "awaiting", label: "Awaiting" },
  { key: "prep", label: "In prep" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

export function segmentOf(status: InvoiceStatus): Exclude<Segment, "all"> {
  if (status === "sent") return "awaiting";
  if (status === "paid") return "paid";
  return "prep";
}

export function segmentCounts(items: InvoiceItem[]): Record<Segment, number> {
  const counts: Record<Segment, number> = { awaiting: 0, prep: 0, paid: 0, all: items.length };
  for (const i of items) counts[segmentOf(i.status)] += 1;
  return counts;
}

/**
 * What a segment lists, in the order that matters there: what to collect
 * first (past due, then by due date), what is being prepared (by due date),
 * and what came in most recently.
 */
export function invoicesIn(items: InvoiceItem[], segment: Segment, now: Date): InvoiceItem[] {
  const today = todayAsUtcDate(now);
  const rows = segment === "all" ? [...items] : items.filter((i) => segmentOf(i.status) === segment);
  const byDue = (a: InvoiceItem, b: InvoiceItem) => a.due_date.localeCompare(b.due_date);
  const byNumber = (a: InvoiceItem, b: InvoiceItem) =>
    (a.invoice_number ?? "").localeCompare(b.invoice_number ?? "", undefined, { numeric: true });
  if (segment === "awaiting") {
    return rows.sort(
      (a, b) => Number(isPastDue(b, today)) - Number(isPastDue(a, today)) || byDue(a, b) || byNumber(a, b)
    );
  }
  if (segment === "prep") return rows.sort((a, b) => byDue(a, b) || byNumber(a, b));
  return rows.sort((a, b) => byDue(b, a) || byNumber(b, a));
}

/** The header of the tab: the dashboard's "awaiting payment" card, from the same function. */
export function awaitingSummary(items: InvoiceItem[], now: Date): Awaiting {
  return awaitingOf(items, todayAsUtcDate(now));
}

/** "Invoice 0142", or how the web names one without a number. */
export function invoiceTitle(inv: Pick<InvoiceItem, "invoice_number">): string {
  return inv.invoice_number ? `Invoice ${inv.invoice_number}` : "Invoice without number";
}
