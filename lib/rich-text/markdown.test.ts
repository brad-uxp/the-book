import { describe, expect, it } from "vitest";
import { generateHTML } from "@tiptap/html/server";
import { richTextExtensions } from "./extensions";
import { TOO_CHANGED, agentHtml, htmlToMarkdown, markdownDiff, markdownToHtml } from "./markdown";

/** HTML as the editor saves it: the same schema, serialized the same way. */
function editorHtml(content: unknown[]): string {
  return generateHTML({ type: "doc", content } as never, richTextExtensions({ placeholder: "" }));
}

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const person = { type: "mention", attrs: { id: "p-1", label: "Ana" } };
const invoice = { type: "invoiceMention", attrs: { id: "inv-9", label: "Inv 12: Acme — $1,200.00" } };

// Lo que el editor guarda hoy, con cada bloque y marca del esquema.
const RICH = editorHtml([
  { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
  p(
    text("Some "),
    text("bold", [{ type: "bold" }]),
    text(", "),
    text("italic", [{ type: "italic" }]),
    text(", "),
    text("code", [{ type: "code" }]),
    text(" and a "),
    text("link", [{ type: "link", attrs: { href: "https://example.com" } }]),
    text(".")
  ),
  {
    type: "bulletList",
    content: [
      { type: "listItem", content: [p(text("one")), { type: "bulletList", content: [{ type: "listItem", content: [p(text("nested"))] }] }] },
    ],
  },
  { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p(text("first"))] }] },
  { type: "blockquote", content: [p(text("quoted"))] },
  { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;")] },
  { type: "horizontalRule" },
  p(text("line"), { type: "hardBreak" }, text("break")),
]);

describe("htmlToMarkdown", () => {
  it("lee cada bloque y marca del editor como markdown", () => {
    expect(htmlToMarkdown(RICH)).toBe(
      [
        "## Plan",
        "",
        "Some **bold**, *italic*, `code` and a [link](https://example.com).",
        "",
        "- one",
        "  - nested",
        "",
        "1. first",
        "",
        "> quoted",
        "",
        "```ts",
        "const a = 1;",
        "```",
        "",
        "---",
        "",
        "line  ",
        "break",
      ].join("\n")
    );
  });

  it("los chips se leen como texto, con el carácter con que se escribieron", () => {
    const html = editorHtml([p(text("Ask "), person, text(" about "), invoice)]);
    expect(html).toContain('data-mention-id="p-1"');
    expect(htmlToMarkdown(html)).toBe("Ask @Ana about #Inv 12: Acme — $1,200.00");
  });

  it("vacío es vacío", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("<p></p>")).toBe("");
  });
});

describe("ida y vuelta", () => {
  it("HTML del editor → markdown → HTML da el mismo HTML", () => {
    expect(markdownToHtml(htmlToMarkdown(RICH))).toBe(RICH);
  });

  it("markdown → HTML → markdown da el mismo markdown", () => {
    const md = htmlToMarkdown(RICH);
    expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
  });

  it("con chips: vuelven como texto plano, nunca como chips", () => {
    const html = editorHtml([p(text("Ask "), person, text(" about "), invoice)]);
    const back = markdownToHtml(htmlToMarkdown(html));
    expect(back).toBe("<p>Ask @Ana about #Inv 12: Acme — $1,200.00</p>");
    expect(htmlToMarkdown(back)).toBe(htmlToMarkdown(html));
  });

  it("los caracteres de markdown en el texto sobreviven", () => {
    const html = editorHtml([p(text("5*3*2, a_b_c, [x], `y`, a < b & c > d"))]);
    expect(markdownToHtml(htmlToMarkdown(html))).toBe(html);
  });
});

describe("markdownToHtml: lo que escribe un agente", () => {
  it("nunca crea un chip, ni con el HTML del chip", () => {
    const planted =
      'Total: <span data-type="invoiceMention" class="invoice-mention" data-id="inv-9" data-label="x" ' +
      'data-invoice-id="inv-9" data-invoice-label="x">x</span> and @Ana #Inv 12';
    const html = markdownToHtml(planted);
    // Una sola etiqueta, el párrafo: el chip plantado quedó como su texto, escapado.
    expect(html.match(/<[a-z]+/g)).toEqual(["<p"]);
    expect(html).toContain("&lt;span data-type=");
    expect(html).toContain("@Ana #Inv 12");
  });

  it("el HTML crudo queda como texto", () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("un link que no es http(s) no queda como link", () => {
    const html = markdownToHtml("[click](javascript:alert(1)) and [ok](https://example.com)");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
  });

  it("vacío es vacío", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml("  \n ")).toBe("");
  });
});

describe("agentHtml: el HTML de un agente", () => {
  it("queda en el esquema del editor, sin chips y sin lo que el esquema no conoce", () => {
    const html =
      '<p onclick="x()">Hi <span data-type="mention" class="mention" data-id="p-1" data-label="Ana" data-mention-id="p-1" ' +
      'data-mention-label="Ana">Ana</span></p><script>alert(1)</script><iframe src="https://evil.example"></iframe>';
    expect(agentHtml(html)).toBe("<p>Hi Ana</p>");
  });

  it("lo que ya es del editor no cambia", () => {
    const html = markdownToHtml("**Ready** — see [PR](https://example.com)");
    expect(agentHtml(html)).toBe(html);
  });
});

describe("markdownDiff", () => {
  it("sin cambios, null", () => {
    expect(markdownDiff("a\n\nb", "a\n\nb")).toBeNull();
  });

  it("las líneas que cambiaron, con una de contexto", () => {
    const before = "## Questions\n\n1. A or B?\n\nNext: ship";
    const after = "## Questions\n\n1. A or B?\n\n**Brad:** A.\n\nNext: ship";
    expect(markdownDiff(before, after)).toBe("@@ -3,3 +3,5 @@\n 1. A or B?\n \n+**Brad:** A.\n+\n Next: ship");
  });

  it("acotado: un texto cambiado entero, largo, no se diffea", () => {
    const before = Array.from({ length: 1500 }, (_, i) => `old line ${i}`).join("\n\n");
    const after = Array.from({ length: 1500 }, (_, i) => `new line ${i}`).join("\n\n");
    expect(markdownDiff(before, after)).toBe(TOO_CHANGED);
  });

  it("el mismo texto serializado distinto por TipTap no es un cambio", () => {
    const a = htmlToMarkdown("<p><strong>Ready</strong> to review</p>");
    const b = htmlToMarkdown('<p><b>Ready</b> to review</p>');
    expect(markdownDiff(a, b)).toBeNull();
  });
});
