import { getSchema, type AnyExtension, type JSONContent } from "@tiptap/core";
import { generateHTML } from "@tiptap/html/server";
import { MarkdownManager } from "@tiptap/markdown";
import { DOMParser as SchemaParser } from "@tiptap/pm/model";
import { structuredPatch } from "diff";
import { Window } from "happy-dom";
import { runInNewContext } from "node:vm";
import { MENTION_NODE, richTextExtensions } from "./extensions";

/**
 * Markdown for agents: what an agent reads of a rich text, and how what it
 * writes becomes one. An agent never sees or sends HTML — the MCP (F2 of
 * docs/product/features/agentes-y-mcp.md) converts both ways, here.
 *
 * Server only: reading HTML needs a DOM — happy-dom, in a window that cannot
 * run a script or reach the network (parseHtml). The phone's editor bundle
 * imports extensions.ts, never this file.
 *
 * Both directions go through the editor's own schema (extensions.ts), so the
 * HTML written is what the web editor itself would save, and anything the
 * schema does not know — a script, an image, an unsafe link — never reaches
 * the stored note.
 */

const SCHEMA = richTextExtensions({ placeholder: "" });

/**
 * The schema without the two chips. What an agent writes is parsed with this,
 * so no markdown, and no HTML inside it, can make a `@person` or `#invoice`
 * chip: planting an invoice's chip and reading its amount back once the web
 * refreshed the label is what the agent's note must never allow (F1).
 */
const WRITE_SCHEMA = SCHEMA.filter(
  (ext) => ext.name !== MENTION_NODE.person && ext.name !== MENTION_NODE.invoice
);

const markdown = new MarkdownManager({ extensions: WRITE_SCHEMA });

/**
 * A window that loads nothing. Not all stored HTML is the editor's — an
 * automation token can write any through the REST API — and from Railway a
 * fetch is a request into its private network. A DOMParser document is
 * inert in happy-dom today; the interceptor refuses every request anyway,
 * so that never rests on a detail of happy-dom (markdown-network.test.ts
 * checks each way HTML can fetch).
 */
const INERT_WINDOW: ConstructorParameters<typeof Window>[0] = {
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true,
    disableComputedStyleRendering: true,
    navigation: {
      disableMainFrameNavigation: true,
      disableChildFrameNavigation: true,
      disableChildPageNavigation: true,
      disableFallbackToSetURL: true,
    },
    fetch: {
      interceptor: {
        beforeAsyncRequest: async ({ window }) => new window.Response(null, { status: 403 }),
        beforeSyncRequest: ({ window, request }) => ({
          status: 403,
          statusText: "Forbidden",
          ok: false,
          url: request.url,
          redirected: false,
          headers: new window.Headers(),
          body: null,
        }),
      },
    },
  },
};

const PARSERS = new Map<AnyExtension[], SchemaParser>();

/** HTML as a document of `extensions`' schema: what it does not know is dropped, its text kept. */
function parseHtml(html: string, extensions: AnyExtension[]): JSONContent {
  let parser = PARSERS.get(extensions);
  if (!parser) PARSERS.set(extensions, (parser = SchemaParser.fromSchema(getSchema(extensions))));
  const window = new Window(INERT_WINDOW);
  try {
    const doc = new window.DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, "text/html");
    return parser.parse(doc.body as unknown as globalThis.Node).toJSON();
  } finally {
    // Nothing was loading; the promises only say so.
    window.happyDOM.abort().catch(() => {});
    window.happyDOM.close().catch(() => {});
  }
}

/** The character each chip was typed with, put back in front of its label. */
const CHIP_TRIGGER: Record<string, string> = {
  [MENTION_NODE.person]: "@",
  [MENTION_NODE.invoice]: "#",
};

/** The document with every chip turned into its text: `@Ana`, `#Inv 12: Acme — $1,200.00`. */
function chipsAsText(node: JSONContent): JSONContent {
  const trigger = node.type ? CHIP_TRIGGER[node.type] : undefined;
  if (trigger !== undefined) {
    const label = String(node.attrs?.label ?? node.attrs?.id ?? "");
    return { type: "text", text: `${trigger}${label}`, ...(node.marks ? { marks: node.marks } : {}) };
  }
  return node.content ? { ...node, content: node.content.map(chipsAsText) } : node;
}

/**
 * A stored rich text (TipTap HTML) as markdown. Chips read as their text.
 *
 * TipTap's serializer has its quirks, all of which survive the way back
 * (markdownToHtml): `&`, `<` and `>` come out as entities, underline as
 * `++u++` and highlight as `==h==`. A paragraph that starts like a block —
 * `# x`, `1. x` — reads as that block; the editor's input rules turn those
 * into the block as they are typed, so only pasted text does it.
 */
export function htmlToMarkdown(html: string): string {
  if (html.trim() === "") return "";
  return markdown.serialize(chipsAsText(parseHtml(html, SCHEMA))).trim();
}

/**
 * What an agent wrote, in markdown, as the HTML the editor stores. HTML
 * inside the markdown stays literal text, and so do `@` and `#`: never a
 * chip. The result goes through the schema's parse rules once more, so it
 * is exactly what the editor accepts when it loads it.
 */
export function markdownToHtml(md: string): string {
  if (md.trim() === "") return "";
  return agentHtml(generateHTML(markdown.parse(md), WRITE_SCHEMA));
}

/**
 * markdownToHtml for what an agent sends, with a hard deadline. The markdown
 * lexer (marked, under @tiptap/markdown) is quadratic on runs of emphasis
 * delimiters — 12 KB of `_a*` takes over a second — and a list nested a few
 * hundred deep overflows the stack. Either would freeze the one replica's
 * event loop. Run inside a vm with a timeout, the conversion is interrupted
 * wherever it is (Node terminates the isolate's execution, host functions
 * included), and the module is left as it was. Throws MarkdownTooComplexError.
 */
export function agentMarkdownToHtml(md: string): string {
  try {
    return runInNewContext("convert()", { convert: () => markdownToHtml(md) }, { timeout: CONVERT_TIMEOUT_MS });
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === "ERR_SCRIPT_EXECUTION_TIMEOUT" || err instanceof RangeError) throw new MarkdownTooComplexError();
    throw err;
  }
}

/** A real note converts in a few milliseconds; a cold start in a hundred. */
const CONVERT_TIMEOUT_MS = 500;

export class MarkdownTooComplexError extends Error {
  constructor() {
    super("The note's formatting is too complex to convert");
  }
}

/**
 * HTML an agent wrote, as the editor would store it without chips: anything
 * the schema does not know is dropped, and a chip is left as its text. What
 * the REST API takes from an agent token goes through this too
 * (lib/issues-service.ts), so the MCP is not the only way in that is safe.
 */
export function agentHtml(html: string): string {
  if (html.trim() === "") return "";
  return generateHTML(plainLinks(parseHtml(html, WRITE_SCHEMA)), WRITE_SCHEMA);
}

/**
 * A link's address is all an agent decides about it. The schema keeps a
 * link's class, title, target and rel from the HTML, so `class="invoice-mention"`
 * would draw an invoice chip that is not one — and the editors open chips on
 * click — and an agent could drop `noopener`. Its target and rel are the
 * editor's own defaults.
 */
const AGENT_LINK = { target: "_blank", rel: "noopener noreferrer nofollow", class: null, title: null };

function plainLinks(node: JSONContent): JSONContent {
  const marks = node.marks?.map((mark) =>
    mark.type === "link" ? { ...mark, attrs: { href: mark.attrs?.href ?? null, ...AGENT_LINK } } : mark
  );
  return {
    ...node,
    ...(marks ? { marks } : {}),
    ...(node.content ? { content: node.content.map(plainLinks) } : {}),
  };
}

/**
 * What changed from `before` to `after`, two markdown texts, as unified-diff
 * hunks; null when nothing did. Two lines of context, since every other line
 * of markdown is the blank one between paragraphs. Compare markdown, never
 * HTML: TipTap may serialize the same words differently, and the same
 * converter on both sides makes that noise disappear.
 *
 * Bounded, since it runs on every read and the texts can be long: past
 * DIFF_LIMITS it answers TOO_CHANGED instead, and the caller reads the text.
 */
export function markdownDiff(before: string, after: string): string | null {
  if (before === after) return null;
  const patch = structuredPatch("", "", `${before}\n`, `${after}\n`, "", "", { context: 2, ...DIFF_LIMITS });
  if (!patch) return TOO_CHANGED;
  return patch.hunks
    .map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join("\n"))
    .join("\n");
}

/** How far markdownDiff goes: lines changed, and milliseconds. */
const DIFF_LIMITS = { maxEditLength: 1_000, timeout: 200 };

/** What markdownDiff answers past DIFF_LIMITS. */
export const TOO_CHANGED = "(changed too much to diff: read it whole)";
