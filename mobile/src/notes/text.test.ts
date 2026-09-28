import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveTitle, firstTextLine, fold, isBlankNote, searchText, textLines } from "./text.ts";

test("sin título, la nota se llama por su primera línea con texto", () => {
  assert.equal(effectiveTitle("  ", "<p></p><p>Llamar a Ana</p><p>mañana</p>"), "Llamar a Ana");
  assert.equal(effectiveTitle("Mi título", "<p>otra cosa</p>"), "Mi título");
  assert.equal(effectiveTitle("", "<p></p>"), "Untitled");
  assert.equal(effectiveTitle("", `<p>${"x".repeat(200)}</p>`).length, 80);
});

test("la primera línea sale de párrafos, títulos, listas o saltos", () => {
  assert.equal(firstTextLine("<h2>Plan</h2><p>a</p>"), "Plan");
  assert.equal(firstTextLine("<ul><li>uno</li><li>dos</li></ul>"), "uno");
  assert.equal(firstTextLine("<p>a<br>b</p>"), "a");
});

test("una nota nueva sin nada escrito se puede descartar", () => {
  assert.equal(isBlankNote("", "<p></p>"), true);
  assert.equal(isBlankNote(" ", ""), true);
  assert.equal(isBlankNote("t", ""), false);
  assert.equal(isBlankNote("", "<p>x</p>"), false);
});

test("la búsqueda ignora mayúsculas y acentos, e incluye las menciones", () => {
  assert.equal(fold("Pérez ÁRBOL"), "perez arbol");
  const s = searchText("Reunión", '<p>Con <span data-mention-id="p1">@Ana Pérez</span> &amp; equipo</p>');
  assert.ok(s.includes("reunion"));
  assert.ok(s.includes("@ana perez & equipo"));
});

test("las líneas de una idea, para la lista del canvas", () => {
  assert.deepEqual(textLines("<p>Uno</p><p></p><ul><li>dos</li></ul>"), ["Uno", "dos"]);
});
