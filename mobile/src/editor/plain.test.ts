import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToPlain, isPlainHtml, plainToHtml } from "./plain.ts";

test("párrafos ida y vuelta, con entidades y líneas vacías", () => {
  const html = "<p>Uno &amp; dos</p><p></p><p>a &lt;b&gt;</p>";
  assert.equal(htmlToPlain(html), "Uno & dos\n\na <b>");
  assert.equal(plainToHtml("Uno & dos\n\na <b>"), html);
  assert.equal(plainToHtml(htmlToPlain(html)), html);
});

test("vacío es vacío", () => {
  assert.equal(htmlToPlain(""), "");
  assert.equal(plainToHtml(""), "");
});

test("solo los párrafos simples se editan como texto; lo enriquecido no", () => {
  assert.equal(isPlainHtml("<p>a</p><p>b<br>c</p>"), true);
  assert.equal(isPlainHtml(""), true);
  assert.equal(isPlainHtml("<p><strong>a</strong></p>"), false);
  assert.equal(isPlainHtml("<ul><li>a</li></ul>"), false);
  assert.equal(isPlainHtml('<p>hola <span data-mention-id="p1">@Ana</span></p>'), false);
});
