import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, hasContent, parseRichText } from "./richtext.ts";

test("párrafos con marcas, fusionando el texto contiguo con el mismo estilo", () => {
  const blocks = parseRichText("<p>Hola <strong>mundo</strong> y <em>más</em><strong><em> ambos</em></strong></p>");
  assert.deepEqual(blocks, [
    {
      kind: "p",
      runs: [
        { text: "Hola " },
        { text: "mundo", bold: true },
        { text: " y " },
        { text: "más", italic: true },
        { text: " ambos", bold: true, italic: true },
      ],
    },
  ]);
});

test("títulos, código en línea, resaltado, tachado, subrayado y enlaces", () => {
  const [h, p] = parseRichText(
    '<h2>Plan</h2><p><code>x</code> <mark>ojo</mark> <s>no</s> <u>sí</u> <a href="https://x.dev">link</a></p>'
  );
  assert.equal(h.kind, "h2");
  assert.deepEqual(h.runs, [{ text: "Plan" }]);
  assert.deepEqual(p.runs, [
    { text: "x", code: true },
    { text: " " },
    { text: "ojo", highlight: true },
    { text: " " },
    { text: "no", strike: true },
    { text: " " },
    { text: "sí", underline: true },
    { text: " " },
    { text: "link", link: true },
  ]);
});

test("listas: viñetas y números con su marcador solo en el primer bloque del ítem, y anidadas", () => {
  const blocks = parseRichText(
    "<ul><li><p>uno</p><p>sigue</p></li><li><p>dos</p><ol start=\"3\"><li><p>tres</p></li><li><p>cuatro</p></li></ol></li></ul>"
  );
  assert.deepEqual(
    blocks.map((b) => [b.runs.map((r) => r.text).join(""), b.list]),
    [
      ["uno", { marker: "•", depth: 1 }],
      ["sigue", { marker: null, depth: 1 }],
      ["dos", { marker: "•", depth: 1 }],
      ["tres", { marker: "3.", depth: 2 }],
      ["cuatro", { marker: "4.", depth: 2 }],
    ]
  );
});

test("un ítem sin párrafo adentro igual es un bloque", () => {
  const [b] = parseRichText("<ol><li>suelto</li></ol>");
  assert.deepEqual(b, { kind: "p", runs: [{ text: "suelto" }], list: { marker: "1.", depth: 1 } });
});

test("bloque de código: conserva espacios y saltos, sin marcar <code> como marca", () => {
  const [b] = parseRichText("<pre><code>a  b\n  c &lt;d&gt;</code></pre>");
  assert.deepEqual(b, { kind: "code", runs: [{ text: "a  b\n  c <d>" }] });
});

test("cita, regla y salto de línea duro", () => {
  const blocks = parseRichText("<blockquote><p>dicho</p></blockquote><hr><p>a<br>b<br></p>");
  assert.deepEqual(blocks[0], { kind: "p", runs: [{ text: "dicho" }], quote: 1 });
  assert.deepEqual(blocks[1], { kind: "hr", runs: [] });
  assert.deepEqual(blocks[2], { kind: "p", runs: [{ text: "a\nb" }] });
});

test("menciones: chip con su etiqueta, tipo, id y si está borrada, tal como las escribe el editor", () => {
  const html =
    '<p>Con <span data-type="mention" class="mention" data-id="p1" data-label="Ana" data-mention-suggestion-char="@" data-mention-id="p1" data-mention-label="Ana">Ana</span> y ' +
    '<span data-type="invoiceMention" class="invoice-mention" data-id="i9" data-label="Inv 9: Gone — $5.00 (deleted)" data-mention-suggestion-char="#" data-invoice-id="i9" data-invoice-label="Inv 9: Gone — $5.00 (deleted)" data-deleted="true">Inv 9: Gone — $5.00 (deleted)</span></p>';
  const [b] = parseRichText(html);
  assert.deepEqual(b.runs, [
    { text: "Con " },
    { text: "Ana", mention: { kind: "person", id: "p1", deleted: false } },
    { text: " y " },
    { text: "Inv 9: Gone — $5.00 (deleted)", mention: { kind: "invoice", id: "i9", deleted: true } },
  ]);
});

test("párrafos vacíos se conservan (líneas en blanco) y el espacio entre bloques no es texto", () => {
  const blocks = parseRichText("<p>a</p>\n<p></p>\n<p>b</p>");
  assert.deepEqual(
    blocks.map((b) => b.runs.map((r) => r.text).join("")),
    ["a", "", "b"]
  );
});

test("entidades", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x1F600; &nbsp;x &bogus;"), "a & b <c> \"d\" 'e' 😀  x &bogus;");
});

test("hasContent: vacío, solo espacios o solo un párrafo vacío no es contenido", () => {
  assert.equal(hasContent(parseRichText("")), false);
  assert.equal(hasContent(parseRichText("<p></p>")), false);
  assert.equal(hasContent(parseRichText("<p> </p>")), false);
  assert.equal(hasContent(parseRichText("<p>x</p>")), true);
  assert.equal(hasContent(parseRichText("<hr>")), true);
});

test("HTML roto no rompe: se degrada a su texto", () => {
  const blocks = parseRichText("texto suelto <b>sin cerrar <x-foo>raro</x-foo>");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].runs.map((r) => r.text).join(""), "texto suelto sin cerrar raro");
});
