import { describe, expect, it } from "vitest";
import { generateHTML } from "@tiptap/html/server";
import { richTextExtensions } from "./extensions";
import { htmlToMarkdown } from "./markdown";

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

  it("lo que el esquema del editor no conoce no llega al markdown; su texto sí", () => {
    const html =
      '<p onclick="x()">Hi <b>there</b></p><script>alert(1)</script><img src="https://evil.example/x.png">' +
      '<iframe src="https://evil.example"></iframe>';
    expect(htmlToMarkdown(html)).toBe("Hi **there**");
  });

  it("vacío es vacío", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("<p></p>")).toBe("");
  });
});
