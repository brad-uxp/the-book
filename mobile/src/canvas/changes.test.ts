import { test } from "node:test";
import assert from "node:assert/strict";
import type { PendingMutation } from "../sync/outbox.ts";
import { connectionProblem, duplicateNode, edgeCreateFields, newIdeaOrigin, nodeCreateFields, planRowDelete } from "./changes.ts";

const m = (patch: Partial<PendingMutation>): PendingMutation => ({
  seq: 1,
  mutation_id: "m1",
  entity: "canvas_node",
  op: "upsert",
  entity_id: "n1",
  fields: {},
  base_updated_at: null,
  base_hash: null,
  title_hint: null,
  attempts: 0,
  ...patch,
});

test("crear una idea manda todos sus campos (y nada más)", () => {
  const f = nodeCreateFields({ issue_id: "c1", content: "<p>x</p>", color: null, x: 8, y: 16, width: 280, height: 160 });
  assert.deepEqual(f, { issue_id: "c1", content: "<p>x</p>", color: null, x: 8, y: 16, width: 280, height: 160 });
});

test("crear una conexión manda sus extremos y lados; un lado sin fijar va como null", () => {
  assert.deepEqual(
    edgeCreateFields({ issue_id: "c1", source_id: "a", target_id: "b", source_side: "right", target_side: null }),
    { issue_id: "c1", source_id: "a", target_id: "b", source_side: "right", target_side: null }
  );
});

test("conexiones: no a sí misma, una por dirección; la dirección contraria es otra", () => {
  const edges = [{ source_id: "a", target_id: "b" }];
  assert.equal(connectionProblem(edges, "a", "a"), "self");
  assert.equal(connectionProblem(edges, "a", "b"), "duplicate");
  assert.equal(connectionProblem(edges, "b", "a"), null);
  assert.equal(connectionProblem(edges, "a", "c"), null);
});

test("borrar algo que el servidor nunca vio: se olvida, sin mandar nada", () => {
  const queue = [m({ mutation_id: "create" }), m({ mutation_id: "edit", seq: 2 })];
  assert.deepEqual(planRowDelete(false, queue), { action: "forget", dropped: queue, baseHashFromQueue: null });
});

test("borrar algo que el servidor tiene: se descartan los cambios sin enviar y se juzga contra el texto del servidor", () => {
  const edit = m({ mutation_id: "edit", fields: { content: "<p>mío</p>" }, base_hash: "h-servidor" });
  const sent = m({ mutation_id: "sent", attempts: 1, fields: { x: 1 } });
  assert.deepEqual(planRowDelete(true, [sent, edit]), { action: "delete", dropped: [edit], baseHashFromQueue: "h-servidor" });
});

test("creada acá pero ya enviada: el servidor puede tenerla, se borra de verdad", () => {
  const create = m({ attempts: 1 });
  assert.deepEqual(planRowDelete(false, [create]), { action: "delete", dropped: [], baseHashFromQueue: null });
});

test("sin cambios de texto en cola, el hash lo pone quien borra (el del texto de la fila)", () => {
  assert.equal(planRowDelete(true, [m({ fields: { x: 3 } })]).baseHashFromQueue, null);
});

test("una idea nueva al soltar una conexión en el vacío queda centrada bajo el dedo", () => {
  assert.deepEqual(newIdeaOrigin({ x: 500, y: 300 }, 280), { x: 360, y: 276 });
});

test("duplicar: mismas palabras, color y tamaño, id nuevo, un paso abajo a la derecha en la grilla, sin servidor", () => {
  const src = {
    id: "n1",
    issue_id: "c1",
    content: "<p>idea</p>",
    color: "blue",
    x: 101,
    y: 50,
    width: 344,
    height: 160,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-02T00:00:00.000Z",
    server_updated_at: "2026-09-02T00:00:00.000Z",
  };
  const now = "2026-09-28T12:00:00.000Z";
  assert.deepEqual(duplicateNode(src, "n2", now), {
    ...src,
    id: "n2",
    x: 128,
    y: 72,
    created_at: now,
    updated_at: now,
    server_updated_at: null,
  });
});

