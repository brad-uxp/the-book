import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXT_TOO_LONG, mergeIssue, refusedIdeaCopy, refusedTextCopy, resultEffect, type LocalIssue } from "./merge.ts";
import type { PendingMutation } from "./outbox.ts";
import type { SyncIssueRow } from "../../../lib/sync-protocol.ts";

const server: SyncIssueRow = {
  id: "i1",
  title: "Server title",
  client_id: null,
  category: "note",
  note_format: "text",
  status: "pending",
  progress: 0,
  due_date: null,
  description: "<p>server</p>",
  sort_order: 0,
  created_at: "2026-09-28T09:00:00.000Z",
  updated_at: "2026-09-28T10:00:00.000Z",
};

const local: LocalIssue = {
  ...server,
  title: "Phone title",
  description: "<p>phone</p>",
  updated_at: "2026-09-28T11:00:00.000Z",
  server_updated_at: "2026-09-28T09:30:00.000Z",
  announced: 1,
  deleted_at: null,
  sync_error: null,
  search: "",
};

const queued = (fields: Record<string, unknown>, op: "upsert" | "delete" = "upsert"): PendingMutation => ({
  seq: 1, mutation_id: "m", entity: "issue", op, entity_id: "i1", fields, base_updated_at: null, base_hash: null, title_hint: null, attempts: 0,
});

test("sin cambios en cola, la fila del servidor reemplaza la del teléfono", () => {
  const m = mergeIssue(local, server, []);
  assert.notEqual(m, "skip");
  if (m === "skip") return;
  assert.equal(m.title, "Server title");
  assert.equal(m.description, "<p>server</p>");
  assert.equal(m.server_updated_at, server.updated_at);
  assert.equal(m.search, "server title server");
});

test("con un cambio en cola, sus campos quedan como los tiene el teléfono", () => {
  const m = mergeIssue(local, { ...server, status: "blocked" }, [queued({ description: "<p>phone</p>" })]);
  if (m === "skip") return assert.fail();
  assert.equal(m.description, "<p>phone</p>");
  assert.equal(m.title, "Server title");
  assert.equal(m.status, "blocked");
  assert.equal(m.updated_at, local.updated_at);
});

test("un delete en cola: la fila no se toca", () => {
  assert.equal(mergeIssue(local, server, [queued({}, "delete")]), "skip");
});

test("una fila nueva del servidor entra tal cual", () => {
  const m = mergeIssue(null, server, []);
  if (m === "skip") return assert.fail();
  assert.equal(m.announced, 1);
  assert.equal(m.deleted_at, null);
});

test("un borrado local que aún espera su Undo sigue oculto", () => {
  const m = mergeIssue({ ...local, deleted_at: 123 }, server, []);
  if (m === "skip") return assert.fail();
  assert.equal(m.deleted_at, 123);
});

test("respuestas: aplicada con fila → reemplaza; borrada → se va; rechazada con fila → vuelve la del servidor", () => {
  assert.deepEqual(resultEffect({ mutation_id: "m", status: "applied", row: server }, "upsert", []), { kind: "row", row: server, restore: false });
  assert.deepEqual(resultEffect({ mutation_id: "m", status: "deleted" }, "upsert", []), { kind: "drop" });
  assert.deepEqual(resultEffect({ mutation_id: "m", status: "applied", row: null, reason: "already_deleted" }, "delete", []), { kind: "drop" });
  assert.deepEqual(
    resultEffect({ mutation_id: "m", status: "rejected", reason: "changed_on_server", row: server }, "delete", []),
    { kind: "row", row: server, restore: true }
  );
});

test("un rechazo sin fila de algo creado en el teléfono: se conserva y se marca", () => {
  assert.deepEqual(resultEffect({ mutation_id: "m", status: "rejected", reason: "invalid", row: null }, "upsert", []), { kind: "flag", reason: "invalid" });
});

test("editar algo borrado en el servidor: el texto quedó en una copia, la fila se va", () => {
  assert.deepEqual(
    resultEffect({ mutation_id: "m", status: "conflict_copy", reason: "deleted_on_server", row: null, conflict_copy_id: "c" }, "upsert", []),
    { kind: "drop" }
  );
});

test("si quedan cambios en cola para la fila (deshacer tras borrar), no se borra", () => {
  assert.deepEqual(resultEffect({ mutation_id: "m", status: "applied", row: null }, "delete", [queued({ title: "t" })]), { kind: "none" });
});

test("un texto demasiado largo para el servidor no se pisa con la fila que llega, y sigue marcado", () => {
  const long = { ...local, description: "<p>largo</p>", sync_error: TEXT_TOO_LONG };
  const m = mergeIssue(long, { ...server, title: "Otro título" }, []);
  assert.notEqual(m, "skip");
  if (m === "skip") return;
  assert.equal(m.description, "<p>largo</p>");
  assert.equal(m.title, "Otro título");
  assert.equal(m.sync_error, TEXT_TOO_LONG);
});

test("cualquier otro error de sync no protege el texto: la fila del servidor gana y el error se limpia", () => {
  const m = mergeIssue({ ...local, sync_error: "invalid" }, server, []);
  assert.notEqual(m, "skip");
  if (m === "skip") return;
  assert.equal(m.description, server.description);
  assert.equal(m.sync_error, null);
});

const NOW = "2026-09-28T12:00:00.000Z";
const sentText = (description: string) => ({ op: "upsert" as const, fields: { description } });

test("un cambio con texto rechazado: las palabras quedan en una nota local «(not synced)» antes de que la fila del servidor las pise", () => {
  const result = { mutation_id: "m", status: "rejected" as const, reason: "server_error", row: server };
  const copy = refusedTextCopy(result, sentText("<p>lo que escribí</p>"), local, "copy-1", NOW);
  assert.ok(copy);
  assert.equal(copy.id, "copy-1");
  assert.equal(copy.title, "Phone title (not synced)");
  assert.equal(copy.description, "<p>lo que escribí</p>");
  assert.equal(copy.sync_error, "server_error");
  // Visible en la lista, fuera de la cola: se manda solo si se edita.
  assert.equal(copy.announced, 1);
  assert.equal(copy.server_updated_at, null);
});

test("sin copia cuando no se pierde nada", () => {
  const rejected = { mutation_id: "m", status: "rejected" as const, reason: "invalid", row: server };
  // El servidor ya tiene ese texto.
  assert.equal(refusedTextCopy(rejected, sentText(server.description), local, "c", NOW), null);
  // El cambio no traía texto.
  assert.equal(refusedTextCopy(rejected, { op: "upsert", fields: { title: "x" } }, local, "c", NOW), null);
  // Traía texto vacío.
  assert.equal(refusedTextCopy(rejected, sentText("<p></p>"), local, "c", NOW), null);
  // Se aplicó.
  assert.equal(refusedTextCopy({ ...rejected, status: "applied" }, sentText("<p>x</p>"), local, "c", NOW), null);
  // Una nota que el servidor nunca confirmó es del teléfono: se queda como está, marcada.
  assert.equal(refusedTextCopy(rejected, sentText("<p>x</p>"), { ...local, server_updated_at: null }, "c", NOW), null);
});

test("el título de la copia nunca pasa del límite del servidor", () => {
  const result = { mutation_id: "m", status: "rejected" as const, reason: "server_error", row: server };
  const copy = refusedTextCopy(result, sentText("<p>x</p>"), { ...local, title: "t".repeat(600) }, "c", NOW);
  assert.ok(copy && copy.title.length <= 500 && copy.title.endsWith(" (not synced)"));
});

test("una idea rechazada con texto que el servidor no tiene: queda como nota local marcada, con el nombre del canvas", () => {
  const rejected = { mutation_id: "m", status: "rejected" as const, reason: "server_error", row: null };
  const copy = refusedIdeaCopy(rejected, { op: "upsert", fields: { content: "<p>idea</p>" } }, "Estrategia", "copy-9", "2026-09-28T10:00:00.000Z");
  assert.equal(copy?.title, "Estrategia · idea (not synced)");
  assert.equal(copy?.description, "<p>idea</p>");
  assert.equal(copy?.sync_error, "server_error");
  assert.equal(copy?.server_updated_at, null);
  assert.equal(copy?.announced, 1);
});

test("una idea rechazada cuyo texto el servidor ya tiene, o sin texto: nada que guardar", () => {
  const withRow = {
    mutation_id: "m",
    status: "rejected" as const,
    reason: "invalid",
    row: { id: "n", issue_id: "c", content: "<p>idea</p>", color: null, x: 0, y: 0, width: 280, height: 160, created_at: "", updated_at: "" },
  };
  assert.equal(refusedIdeaCopy(withRow, { op: "upsert", fields: { content: "<p>idea</p>" } }, "C", "x", "t"), null);
  assert.equal(refusedIdeaCopy(withRow, { op: "upsert", fields: { x: 3 } }, "C", "x", "t"), null);
  assert.equal(refusedIdeaCopy({ ...withRow, status: "applied" }, { op: "upsert", fields: { content: "<p>otra</p>" } }, "C", "x", "t"), null);
});
