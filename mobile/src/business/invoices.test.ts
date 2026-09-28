import { test } from "node:test";
import assert from "node:assert/strict";
import {
  awaitingSummary,
  invoicePastDue,
  invoicesIn,
  invoiceTitle,
  segmentCounts,
  toInvoiceItem,
  toInvoiceItems,
  type InvoiceItem,
} from "./invoices.ts";

// 2026-10-01 01:00 UTC is still Sep 30 in Montevideo: nothing due Sep 30 is late yet.
const LATE_SEP_30 = new Date("2026-10-01T01:00:00Z");
const OCT_2 = new Date("2026-10-02T15:00:00Z");

const api = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  invoice_number: "0142",
  client_id: "c1",
  amount_cents: 1_000_00,
  fee_cents: -100_00,
  status: "sent",
  due_date: "2026-09-30T00:00:00.000Z",
  notes: null,
  file_url: null,
  file_key: "invoices/inv-1/abc.pdf",
  client: { id: "c1", name: "Lumen Labs", color_hex: "#10B981", default_referrer_id: null },
  referrer: { id: "r1", name: "Ana", color_hex: "#F97316" },
  ...over,
});

test("de la API se queda con lo que muestra: neto calculado, PDF como sí/no, sin la clave del archivo", () => {
  const item = toInvoiceItem(api());
  assert.ok(item);
  assert.equal(item.net_cents, 900_00);
  assert.equal(item.has_file, true);
  assert.equal(item.referrer?.name, "Ana");
  assert.equal("file_key" in item, false);
  assert.equal(toInvoiceItem(api({ file_key: null, file_url: null }))?.has_file, false);
  assert.equal(toInvoiceItem(api({ referrer: null }))?.referrer, null);
});

test("lo que no es una factura se descarta; una respuesta que no es lista es un error", () => {
  assert.equal(toInvoiceItem(api({ status: "draft" })), null);
  assert.equal(toInvoiceItem(api({ client: null })), null);
  assert.deepEqual(toInvoiceItems([api(), { nope: true }]).map((i) => i.id), ["inv-1"]);
  assert.throws(() => toInvoiceItems({ error: "x" }));
});

const make = (id: string, status: string, due: string, number = id): InvoiceItem =>
  toInvoiceItem(api({ id, status, due_date: `${due}T00:00:00.000Z`, invoice_number: number }))!;

const items = [
  make("a", "sent", "2026-09-30"),
  make("b", "sent", "2026-08-31"),
  make("c", "pending", "2026-10-31"),
  make("d", "accounting", "2026-09-30"),
  make("e", "paid", "2026-07-31"),
  make("f", "paid", "2026-09-30"),
];

test("segmentos: Awaiting = Sent, In prep = Pending + Accounting", () => {
  assert.deepEqual(segmentCounts(items), { awaiting: 2, prep: 2, paid: 2, all: 6 });
});

test("vencida recién desde el día siguiente al fin de mes, en Montevideo", () => {
  assert.equal(invoicePastDue(items[0], LATE_SEP_30), false);
  assert.equal(invoicePastDue(items[0], OCT_2), true);
  assert.equal(invoicePastDue(items[3], OCT_2), false, "solo las Sent se vencen");
});

test("orden: por cobrar con las vencidas primero; en preparación por vencimiento; pagadas lo más reciente primero", () => {
  assert.deepEqual(invoicesIn(items, "awaiting", LATE_SEP_30).map((i) => i.id), ["b", "a"]);
  assert.deepEqual(invoicesIn(items, "prep", OCT_2).map((i) => i.id), ["d", "c"]);
  assert.deepEqual(invoicesIn(items, "paid", OCT_2).map((i) => i.id), ["f", "e"]);
  assert.equal(invoicesIn(items, "all", OCT_2).length, 6);
});

test("el resumen de cabecera es el de la tarjeta del dashboard", () => {
  assert.deepEqual(awaitingSummary(items, OCT_2), { count: 2, netCents: 1_800_00, pastDueCount: 2 });
  assert.deepEqual(awaitingSummary(items, LATE_SEP_30), { count: 2, netCents: 1_800_00, pastDueCount: 1 });
});

test("título", () => {
  assert.equal(invoiceTitle({ invoice_number: "0142" }), "Invoice 0142");
  assert.equal(invoiceTitle({ invoice_number: null }), "Invoice without number");
});
