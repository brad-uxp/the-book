import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs, changedFields, coalesce, hasPendingDelete, pendingFields, type PendingMutation } from "./outbox.ts";

const pending = (patch: Partial<PendingMutation> = {}): PendingMutation => ({
  seq: 1,
  mutation_id: "m1",
  entity: "issue",
  op: "upsert",
  entity_id: "i1",
  fields: { title: "a" },
  base_updated_at: "2026-09-28T10:00:00.000Z",
  base_hash: null,
  title_hint: "a",
  attempts: 0,
  ...patch,
});

test("sin nada en cola, el cambio se agrega", () => {
  assert.deepEqual(coalesce(null, { fields: { title: "b" }, base_updated_at: null, base_hash: null }), { action: "append" });
});

test("un cambio sin enviar absorbe el siguiente, que pisa sus campos", () => {
  const r = coalesce(pending(), { fields: { title: "b", status: "done" }, base_updated_at: "x", base_hash: null });
  assert.deepEqual(r, { action: "merge", fields: { title: "b", status: "done" }, base_hash: null, title_hint: "a" });
});

test("el texto conserva la PRIMERA base: contra ella se juzga un conflicto", () => {
  const first = pending({ fields: { description: "<p>1</p>" }, base_hash: "h0" });
  const r = coalesce(first, { fields: { description: "<p>12</p>" }, base_updated_at: "x", base_hash: "h1" });
  assert.equal(r.action === "merge" && r.base_hash, "h0");
});

test("si el texto cambia por primera vez en la cola, su base es la del cambio nuevo", () => {
  const r = coalesce(pending(), { fields: { description: "<p>x</p>" }, base_updated_at: "x", base_hash: "hx" });
  assert.equal(r.action === "merge" && r.base_hash, "hx");
});

test("un cambio que ya viajó no se toca: un reintento devolvería la respuesta guardada", () => {
  assert.deepEqual(coalesce(pending({ attempts: 1 }), { fields: { title: "c" }, base_updated_at: null, base_hash: null }), { action: "append" });
});

test("un delete en cola no absorbe ediciones", () => {
  assert.deepEqual(coalesce(pending({ op: "delete", fields: {} }), { fields: { title: "c" }, base_updated_at: null, base_hash: null }), { action: "append" });
});

test("campos pendientes y deletes pendientes", () => {
  const q = [pending({ fields: { title: "a", description: "d" } }), pending({ seq: 2, fields: { status: "done" } })];
  assert.deepEqual([...pendingFields(q)].sort(), ["description", "status", "title"]);
  assert.equal(hasPendingDelete(q), false);
  assert.equal(hasPendingDelete([...q, pending({ op: "delete", fields: {} })]), true);
});

test("solo los campos que de verdad cambian", () => {
  assert.deepEqual(changedFields({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: null }), { b: "y" });
});

test("reintentos con espera creciente, con tope", () => {
  assert.deepEqual([0, 1, 2, 3, 10].map(backoffMs), [0, 5000, 10000, 20000, 300000]);
});
