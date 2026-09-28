import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPaidAt, monthReport, paydayIn, toPeople, type PersonItem } from "./salaries.ts";

const apiPerson = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Luis Gómez",
  payday_day: 25,
  status: "active",
  role_id: "r1",
  notes: "private",
  created_at: "2025-01-10T12:00:00.000Z",
  role: { id: "r1", name: "Developer" },
  salary_base: { person_id: "p1", base_salary_cents: 3_200_00 },
  salary_payments: [
    { id: "sp2", person_id: "p1", due_date: "2026-08-25T00:00:00.000Z", paid_at: "2026-08-26T00:00:00.000Z", base_salary_cents_snapshot: 3_200_00, adjustment_cents: 100_00, adjustment_note: "bonus", total_cents: 3_300_00 },
  ],
  increase_reminders: [],
  ...over,
});

test("de la API se queda con lo que el informe usa, sin notas privadas", () => {
  const [p] = toPeople([apiPerson()]);
  assert.equal(p.role, "Developer");
  assert.equal(p.base_salary_cents, 3_200_00);
  assert.deepEqual(p.payments[0], { id: "sp2", due_date: "2026-08-25", paid_at: "2026-08-26", total_cents: 3_300_00, adjustment_cents: 100_00, adjustment_note: "bonus" });
  assert.equal("notes" in p, false);
  assert.throws(() => toPeople({ error: "x" }));
});

test("el día de pago se ajusta al largo del mes, como en el servidor", () => {
  assert.equal(paydayIn("2026-02", 31), "2026-02-28");
  assert.equal(paydayIn("2028-02", 30), "2028-02-29");
  assert.equal(paydayIn("2026-09", 25), "2026-09-25");
});

const person = (id: string, over: Partial<PersonItem> = {}): PersonItem => ({
  id,
  name: id,
  role: null,
  status: "active",
  payday_day: 25,
  base_salary_cents: 1_000_00,
  created_at: "2025-01-01",
  payments: [],
  ...over,
});
const pay = (month: string, total: number) => ({
  id: `sp-${month}`,
  due_date: `${month}-25`,
  paid_at: `${month}-25`,
  total_cents: total,
  adjustment_cents: 0,
  adjustment_note: null,
});

test("un mes: quién cobró, quién no, con atraso y totales", () => {
  const people = [
    person("Ana", { payments: [pay("2026-09", 1_050_00), pay("2026-08", 1_000_00)] }),
    person("Bruno", { payday_day: 30, payments: [pay("2026-08", 1_000_00)] }),
    person("Carla", { payday_day: 5 }),
    person("Dora", { status: "inactive" }),
    person("Eva", { created_at: "2026-10-02" }),
  ];
  const r = monthReport(people, "2026-09", "2026-09-27");
  assert.deepEqual(r.paid.map((l) => l.person.id), ["Ana"]);
  assert.deepEqual(
    r.unpaid.map((l) => [l.person.id, l.due, l.daysLate]),
    [["Carla", "2026-09-05", 22], ["Bruno", "2026-09-30", 0]]
  );
  assert.equal(r.paidCents, 1_050_00);
  assert.equal(r.unpaidCents, 2_000_00);
  assert.equal(r.people, 3, "Dora está inactiva y Eva entró después");
});

test("un mes pasado: quien hoy está inactivo pero cobró ese mes aparece como pagado", () => {
  const people = [person("Dora", { status: "inactive", payments: [pay("2026-07", 900_00)] })];
  const r = monthReport(people, "2026-07", "2026-09-27");
  assert.deepEqual(r.paid.map((l) => l.person.id), ["Dora"]);
  assert.equal(r.unpaid.length, 0);
});

test("un pago adelantado del mes que viene no tapa el de este mes", () => {
  const people = [person("Ana", { payments: [pay("2026-10", 1_000_00)] })];
  const r = monthReport(people, "2026-09", "2026-09-27");
  assert.deepEqual(r.unpaid.map((l) => l.person.id), ["Ana"]);
});

test("fecha por defecto al registrar: hoy en este mes, el día de pago en uno pasado", () => {
  assert.equal(defaultPaidAt("2026-09", "2026-09-27", 25), "2026-09-27");
  assert.equal(defaultPaidAt("2026-02", "2026-09-27", 31), "2026-02-28");
});
