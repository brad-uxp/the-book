import { test } from "node:test";
import assert from "node:assert/strict";
import { SUGGESTION_LIMIT, matchInvoices, matchPeople, type MentionPerson } from "./suggestions.ts";

const people: MentionPerson[] = [
  { id: "1", name: "Ana Díaz", role: "Designer", active: true },
  { id: "2", name: "Bruno Sosa", role: "Developer", active: true },
  { id: "3", name: "Ana Viejo", role: "Developer", active: false },
  { id: "4", name: "Carla", role: null, active: true },
];

test("personas: solo activas, por nombre o rol, sin distinguir mayúsculas", () => {
  assert.deepEqual(matchPeople(people, "").map((p) => p.id), ["1", "2", "4"]);
  assert.deepEqual(matchPeople(people, "ana").map((p) => p.id), ["1"]);
  assert.deepEqual(matchPeople(people, "DEV").map((p) => p.id), ["2"]);
  assert.deepEqual(matchPeople(people, "zzz"), []);
});

test("facturas: por la etiqueta, que lleva número, cliente y monto", () => {
  const invoices = [
    { id: "a", label: "Inv 0142: Acme — $1,200.00", status: "sent" },
    { id: "b", label: "Inv ?: Globex — $5.00", status: "draft" },
  ];
  assert.deepEqual(matchInvoices(invoices, "0142").map((i) => i.id), ["a"]);
  assert.deepEqual(matchInvoices(invoices, "globex").map((i) => i.id), ["b"]);
  assert.deepEqual(matchInvoices(invoices, "").map((i) => i.id), ["a", "b"]);
});

test("nunca más de las que muestra la web", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `P${i}`, active: true }));
  assert.equal(matchPeople(many, "").length, SUGGESTION_LIMIT);
  assert.equal(matchPeople(many, "p").length, SUGGESTION_LIMIT);
});
