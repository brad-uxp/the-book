// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type AnyExtension } from "@tiptap/core";
import type { SuggestionProps } from "@tiptap/suggestion";
import { MENTION_NODE, richTextExtensions } from "./extensions";
import { syncMentionLabels } from "./mention-sync";
// The phone's editor page builds its extensions here; the web and the phone
// have to write the same HTML.
import { pageExtensions } from "../../mobile/editor-web/extensions";

const person = (id: string, label: string, extra = "") =>
  `<span data-type="mention" class="mention" data-id="${id}" data-label="${label}" data-mention-suggestion-char="@"${extra} data-mention-id="${id}" data-mention-label="${label}">${label}</span>`;
const invoice = (id: string, label: string, extra = "") =>
  `<span data-type="invoiceMention" class="invoice-mention" data-id="${id}" data-label="${label}" data-mention-suggestion-char="#"${extra} data-invoice-id="${id}" data-invoice-label="${label}">${label}</span>`;
const DELETED = ' data-deleted="true"';

/**
 * Stored HTML in, and what the editor saves back out. The expected values
 * were produced by the web editor's configuration as it was before it moved
 * to lib/rich-text — so they also prove that move changed nothing on disk.
 */
const SAMPLES: Record<string, { html: string; saved: string }> = {
  formatting: {
    html: '<h2>Plan</h2><p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code>.</p><h3>Next</h3><h4>Detail</h4><ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>first</p></li></ol><pre><code>const x = 1 &lt; 2;</code></pre><p>a &amp; b "c" \'d\'</p>',
    saved:
      '<h2>Plan</h2><p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code>.</p><h3>Next</h3><h4>Detail</h4><ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>first</p></li></ol><pre><code>const x = 1 &lt; 2;</code></pre><p>a &amp; b "c" \'d\'</p>',
  },
  mentions: {
    html: `<p>Ask ${person("p-ana", "Ana Díaz")} about ${invoice("inv-7", "Inv 7: Acme — $1,200.00")} today.</p>`,
    saved: `<p>Ask ${person("p-ana", "Ana Díaz")} about ${invoice("inv-7", "Inv 7: Acme — $1,200.00")} today.</p>`,
  },
  deleted: {
    // The stored order of attributes differs from what the editor writes.
    html:
      '<p>Was <span data-type="mention" class="mention" data-id="p-bob" data-label="Bob (deleted)" data-mention-suggestion-char="@" data-mention-id="p-bob" data-mention-label="Bob (deleted)" data-deleted="true">Bob (deleted)</span> and ' +
      '<span data-type="invoiceMention" class="invoice-mention" data-id="inv-9" data-label="Inv 9: Gone — $5.00 (deleted)" data-mention-suggestion-char="#" data-invoice-id="inv-9" data-invoice-label="Inv 9: Gone — $5.00 (deleted)" data-deleted="true">Inv 9: Gone — $5.00 (deleted)</span></p>',
    saved: `<p>Was ${person("p-bob", "Bob (deleted)", DELETED)} and ${invoice("inv-9", "Inv 9: Gone — $5.00 (deleted)", DELETED)}</p>`,
  },
  legacyWithoutTriggerChar: {
    html: '<p><span data-type="mention" class="mention" data-id="p-old" data-label="Old (eliminado)" data-mention-id="p-old" data-mention-label="Old (eliminado)" data-deleted="true">Old (eliminado)</span></p>',
    saved: `<p>${person("p-old", "Old (eliminado)", DELETED)}</p>`,
  },
  highlight: {
    // One colour: a bare <mark>. A colour attribute from elsewhere is
    // dropped, not kept — the tone lives in each editor's CSS.
    html: '<p>Keep <mark>this line</mark> in mind, and <mark data-color="#f00" style="background-color: #f00">this</mark>.</p><ul><li><p><strong><mark>both</mark></strong></p></li></ul>',
    saved: '<p>Keep <mark>this line</mark> in mind, and <mark>this</mark>.</p><ul><li><p><strong><mark>both</mark></strong></p></li></ul>',
  },
  empty: { html: "", saved: "<p></p>" },
  link: {
    html: '<p>See <a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">site</a></p>',
    saved: '<p>See <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">site</a></p>',
  },
};

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

function open(extensions: AnyExtension[], content: string): Editor {
  // In the document, so focus and the DOM selection work as in a browser.
  const element = document.body.appendChild(document.createElement("div"));
  const editor = new Editor({ element, extensions, content });
  editors.push(editor);
  return editor;
}

type Captured = { command?: (attrs: { id: string; label: string }) => void; query?: string };

/** The suggestion UI each side really passes: the web's draws a list, the page's reports to native. */
function ui(captured: Captured) {
  const track = (props: SuggestionProps<unknown>) => {
    captured.command = props.command as Captured["command"];
    captured.query = props.query;
  };
  return { items: () => [], render: () => ({ onStart: track, onUpdate: track }) };
}

const web = (c: Captured = {}, i: Captured = {}) =>
  richTextExtensions({ placeholder: "Add a description...", personSuggestion: ui(c), invoiceSuggestion: ui(i) });
const phone = (c: Captured = {}, i: Captured = {}) =>
  pageExtensions({ placeholder: () => "Write something…", person: ui(c), invoice: ui(i) });

describe("the web and the phone write the same HTML", () => {
  it.each(Object.entries(SAMPLES))("%s", (_name, { html, saved }) => {
    expect(open(web(), html).getHTML()).toBe(saved);
    expect(open(phone(), html).getHTML()).toBe(saved);
  });

  it("toggle the highlight the same way, and ⌘⇧H is its shortcut", () => {
    const results = [web, phone].map((make) => {
      const editor = open(make(), "<p>one two three</p>");
      editor.chain().focus().setTextSelection({ from: 5, to: 8 }).toggleHighlight().run();
      expect(editor.isActive("highlight")).toBe(true);
      const toggled = editor.getHTML();
      // The shortcut takes it off again, then puts it back.
      editor.commands.keyboardShortcut("Mod-Shift-h");
      expect(editor.getHTML()).toBe("<p>one two three</p>");
      editor.commands.keyboardShortcut("Mod-Shift-h");
      expect(editor.getHTML()).toBe(toggled);
      return toggled;
    });
    expect(results[0]).toBe("<p>one <mark>two</mark> three</p>");
    expect(results[1]).toBe(results[0]);
  });

  it("have the same schema: nodes, marks and their attributes", () => {
    const describeSchema = (e: Editor) => ({
      nodes: Object.values(e.schema.nodes).map((n) => [n.name, Object.keys(n.spec.attrs ?? {})]),
      marks: Object.values(e.schema.marks).map((m) => [m.name, Object.keys(m.spec.attrs ?? {})]),
    });
    expect(describeSchema(open(phone(), ""))).toEqual(describeSchema(open(web(), "")));
  });

  it.each([
    ["person", "@", "an", { id: "p-ana", label: "Ana Díaz" }, person("p-ana", "Ana Díaz")],
    ["invoice", "#", "7", { id: "inv-7", label: "Inv 7: Acme — $1,200.00" }, invoice("inv-7", "Inv 7: Acme — $1,200.00")],
  ] as const)("choosing a %s from a suggestion inserts the web's markup", async (kind, char, query, attrs, chip) => {
    const results: string[] = [];
    for (const make of [web, phone]) {
      const c: Captured = {};
      const i: Captured = {};
      const editor = open(make(c, i), "<p>Hi</p>");
      editor.chain().focus("end").insertContent(` ${char}${query}`).run();
      // The suggestion plugin reports after awaiting its items.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const captured = kind === "person" ? c : i;
      expect(captured.query).toBe(query);
      captured.command?.(attrs);
      results.push(editor.getHTML());
    }
    expect(results[0]).toBe(`<p>Hi ${chip} </p>`);
    expect(results[1]).toBe(results[0]);
  });
});

describe("syncMentionLabels", () => {
  const doc = `<p>${person("p-ana", "Ana")} ${person("p-bob", "Bob")} ${invoice("inv-7", "Inv 7: Acme — $1.00")}</p>`;

  it("renames the ones that exist and marks the missing ones deleted", () => {
    const editor = open(web(), doc);
    const names: Record<string, string> = { "p-ana": "Ana Díaz" };
    const tr = syncMentionLabels(editor.state, MENTION_NODE.person, (id) => names[id] ?? null);
    expect(tr).not.toBeNull();
    editor.view.dispatch(tr!);
    expect(editor.getHTML()).toBe(
      `<p>${person("p-ana", "Ana Díaz")} ${person("p-bob", "Bob (deleted)", DELETED)} ${invoice("inv-7", "Inv 7: Acme — $1.00")}</p>`
    );
  });

  it("returns null when everything is already in line, and leaves other kinds alone", () => {
    const editor = open(web(), doc);
    const names: Record<string, string> = { "p-ana": "Ana", "p-bob": "Bob" };
    expect(syncMentionLabels(editor.state, MENTION_NODE.person, (id) => names[id] ?? null)).toBeNull();
  });

  it("brings a mention back when its entity reappears, and an old Spanish suffix to the current one", () => {
    const editor = open(web(), SAMPLES.legacyWithoutTriggerChar.html);
    editor.view.dispatch(syncMentionLabels(editor.state, MENTION_NODE.person, () => null)!);
    expect(editor.getHTML()).toBe(`<p>${person("p-old", "Old (deleted)", DELETED)}</p>`);

    editor.view.dispatch(syncMentionLabels(editor.state, MENTION_NODE.person, () => "Old Name")!);
    expect(editor.getHTML()).toBe(`<p>${person("p-old", "Old Name")}</p>`);
  });

  it("syncs invoices by their label", () => {
    const editor = open(phone(), doc);
    const tr = syncMentionLabels(editor.state, MENTION_NODE.invoice, () => "Inv 7: Acme — $2.00");
    editor.view.dispatch(tr!);
    expect(editor.getHTML()).toContain(invoice("inv-7", "Inv 7: Acme — $2.00"));
  });
});
