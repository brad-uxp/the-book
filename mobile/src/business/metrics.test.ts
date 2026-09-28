import { test } from "node:test";
import assert from "node:assert/strict";
import { metricsCacheKey, metricsPath, percent, periodPhrase, stepMonth, toMetricsReport } from "./metrics.ts";

test("cada vista pide lo que la web pide y se guarda bajo su propia clave", () => {
  assert.equal(metricsPath({ kind: "this_year" }), "/api/metrics?period=this_year");
  assert.equal(metricsPath({ kind: "last_12_months" }), "/api/metrics?period=last_12_months");
  assert.equal(metricsPath({ kind: "month", month: "2026-08" }), "/api/metrics?month=2026-08");
  assert.equal(metricsCacheKey({ kind: "this_year" }), "metrics:this_year");
  assert.equal(metricsCacheKey({ kind: "month", month: "2026-08" }), "metrics:month:2026-08");
});

test("el mes avanza y retrocede, sin pasarse del actual", () => {
  assert.deepEqual(stepMonth({ kind: "month", month: "2026-01" }, -1, "2026-09"), { kind: "month", month: "2025-12" });
  assert.deepEqual(stepMonth({ kind: "month", month: "2026-09" }, 1, "2026-09"), { kind: "month", month: "2026-09" });
});

test("frases y porcentajes", () => {
  assert.equal(periodPhrase({ kind: "this_year" }, (m) => m), "this year");
  assert.equal(periodPhrase({ kind: "month", month: "2026-08" }, (m) => `M${m}`), "M2026-08");
  assert.equal(percent(0.6), "60%");
});

const report = {
  period: { kind: "this_year", months: ["2026-01"] },
  today: "2026-09-27",
  awaiting_payment: { count: 7, net_cents: 18_450_00, past_due_count: 2 },
  income_cents: 1,
  expenses: {},
  net_income_cents: 132_000_00,
  monthly_averages: { months: 9, net_income_cents: 14_667_00 },
  corporate: { net_cents: 103_000_00, partner_a_cents: 61_800_00, partner_b_cents: 41_200_00, excluded_clients: [], split: { partner_a: 0.6, partner_b: 0.4 } },
  upcoming: { days: 5, payments: [], invoices: [] },
};

test("acepta la respuesta del servidor y rechaza lo que no lo es, en vez de mostrar ceros", () => {
  assert.equal(toMetricsReport(report).awaiting_payment.count, 7);
  assert.throws(() => toMetricsReport({ error: "Unauthorized" }));
  assert.throws(() => toMetricsReport({ ...report, corporate: { ...report.corporate, net_cents: "1" } }));
  assert.throws(() => toMetricsReport(null));
});
