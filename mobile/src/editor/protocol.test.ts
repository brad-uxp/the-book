import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLBAR_ACTIONS, parseFromPage, parseToPage } from "./protocol.ts";

const active = Object.fromEntries(TOOLBAR_ACTIONS.map((a) => [a, false]));

test("de la página: acepta los mensajes bien formados", () => {
  assert.deepEqual(parseFromPage('{"type":"ready"}'), { type: "ready" });
  assert.deepEqual(parseFromPage(JSON.stringify({ type: "change", docKey: "k", html: "<p>x</p>" })), {
    type: "change",
    docKey: "k",
    html: "<p>x</p>",
  });
  assert.ok(parseFromPage(JSON.stringify({ type: "state", focused: true, active })));
  assert.ok(parseFromPage(JSON.stringify({ type: "suggestion", kind: "invoice", query: "" })));
  assert.ok(parseFromPage(JSON.stringify({ type: "mentionPress", kind: "person", id: "p1" })));
});

test("de la página: descarta lo que no encaja", () => {
  for (const raw of [
    "",
    "not json",
    "null",
    "[]",
    '"change"',
    JSON.stringify({ type: "change", docKey: "k" }),
    JSON.stringify({ type: "change", docKey: 1, html: "" }),
    JSON.stringify({ type: "state", focused: true, active: { bold: true } }),
    JSON.stringify({ type: "suggestion", kind: "task", query: "" }),
    JSON.stringify({ type: "mentionPress", kind: "person" }),
    JSON.stringify({ type: "eval", code: "x" }),
    42,
  ]) {
    assert.equal(parseFromPage(raw), null, String(raw));
  }
});

test("hacia la página: acepta los comandos y rechaza acciones o tipos desconocidos", () => {
  const init = {
    type: "init",
    docKey: "k",
    html: "",
    editable: true,
    placeholder: "Write",
    autoFocus: false,
    dark: true,
    people: [["p1", "Ana"]],
    invoices: [],
  };
  assert.ok(parseToPage(JSON.stringify(init)));
  assert.equal(parseToPage(JSON.stringify({ ...init, people: [["p1"]] })), null);
  assert.equal(parseToPage(JSON.stringify({ ...init, people: null })), null);
  assert.ok(parseToPage(JSON.stringify({ type: "format", action: "h3" })));
  assert.equal(parseToPage(JSON.stringify({ type: "format", action: "h1" })), null);
  assert.ok(parseToPage(JSON.stringify({ type: "pick", kind: "invoice", id: "i", label: "Inv 1" })));
  assert.equal(parseToPage(JSON.stringify({ type: "pick", kind: "invoice", id: "i" })), null);
  assert.equal(parseToPage(JSON.stringify({ type: "navigate", url: "https://x" })), null);
});
