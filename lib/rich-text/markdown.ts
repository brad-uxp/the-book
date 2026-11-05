import { getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { DOMParser as SchemaParser } from "@tiptap/pm/model";
import { Window } from "happy-dom";
import { MENTION_NODE, richTextExtensions } from "./extensions";

/**
 * Markdown for agents: what an agent reads of a rich text. An agent never
 * sees HTML — the MCP (lib/mcp-issues.ts) hands it a task's description as
 * markdown, converted here. Read only: nothing an agent sends becomes HTML.
 *
 * Server only: reading HTML needs a DOM — happy-dom, in a window that cannot
 * run a script or reach the network (parseHtml). The phone's editor bundle
 * imports extensions.ts, never this file.
 *
 * The HTML is read through the editor's own schema (extensions.ts), so
 * anything the schema does not know — a script, an image — never reaches the
 * markdown.
 */

const SCHEMA = richTextExtensions({ placeholder: "" });

const markdown = new MarkdownManager({ extensions: SCHEMA });

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

const PARSER = SchemaParser.fromSchema(getSchema(SCHEMA));

/** HTML as a document of the editor's schema: what it does not know is dropped, its text kept. */
function parseHtml(html: string): JSONContent {
  const window = new Window(INERT_WINDOW);
  try {
    const doc = new window.DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, "text/html");
    return PARSER.parse(doc.body as unknown as globalThis.Node).toJSON();
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
 * TipTap's serializer has its quirks: `&`, `<` and `>` come out as entities,
 * underline as `++u++` and highlight as `==h==`. A paragraph that starts like
 * a block — `# x`, `1. x` — reads as that block; the editor's input rules
 * turn those into the block as they are typed, so only pasted text does it.
 */
export function htmlToMarkdown(html: string): string {
  if (html.trim() === "") return "";
  return markdown.serialize(chipsAsText(parseHtml(html))).trim();
}
