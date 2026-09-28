/**
 * An idea's rich text, as the canvas draws it: blocks of styled runs.
 *
 * The cards are drawn natively — a WebView per card would cost a browser per
 * idea — so the HTML the editor stores (TipTap's, the same on the web: see
 * lib/rich-text) is read here into something <Text> can draw. It only has to
 * understand what that editor writes: paragraphs, headings, lists, quotes,
 * code blocks, rules, hard breaks, the marks (bold, italic, underline,
 * strike, code, highlight, links) and the two mention chips. Anything else
 * degrades to its text.
 *
 * Pure (no React Native), so `node --test` runs it.
 */

export type MentionKind = "person" | "invoice";

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  highlight?: boolean;
  link?: boolean;
  /** A chip: its text is the label; `id` is what it points at. */
  mention?: { kind: MentionKind; id: string; deleted: boolean };
}

export type BlockKind = "p" | "h1" | "h2" | "h3" | "h4" | "code" | "hr";

export interface Block {
  kind: BlockKind;
  runs: Run[];
  /** Inside a list: the marker to draw (only on an item's first block) and how deep. */
  list?: { marker: string | null; depth: number };
  /** Inside a blockquote, how deep. */
  quote?: number;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Record<string, string>;
}

function parseTag(raw: string): Tag | null {
  const m = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/)?\s*>$/.exec(raw);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(m[3]))) {
    attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
  }
  return { name: m[2].toLowerCase(), closing: !!m[1], selfClosing: !!m[4], attrs };
}

const MARK_TAGS: Record<string, keyof Omit<Run, "text" | "mention">> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  s: "strike",
  strike: "strike",
  del: "strike",
  code: "code",
  mark: "highlight",
  a: "link",
};

const BLOCK_TAGS: Record<string, BlockKind> = {
  p: "p",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h4",
  h6: "h4",
};

type Marks = Omit<Run, "text">;

/** An idea's HTML as blocks. Empty paragraphs are kept: they are blank lines the author typed. */
export function parseRichText(html: string): Block[] {
  const blocks: Block[] = [];
  const tokens = html.match(/<[^>]+>|[^<]+/g) ?? [];

  const marks: Marks[] = [{}];
  const lists: { ordered: boolean; next: number }[] = [];
  let quote = 0;
  let current: Block | null = null;
  // An item's marker goes on its first block only; later paragraphs of the
  // same item line up under it without one.
  let pendingMarker: string | null = null;
  let inPre = false;
  // A mention's text is its label; the tags inside it (there are none) and
  // its own text arrive while this is set.
  let mention: Run["mention"] | null = null;
  let mentionDepth = 0;

  const context = (): Pick<Block, "list" | "quote"> => {
    const out: Pick<Block, "list" | "quote"> = {};
    if (lists.length) {
      out.list = { marker: pendingMarker, depth: lists.length };
      pendingMarker = null;
    }
    if (quote) out.quote = quote;
    return out;
  };

  const open = (kind: BlockKind) => {
    close();
    current = { kind, runs: [], ...context() };
  };

  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };

  const addText = (text: string) => {
    if (!text) return;
    if (!current) {
      // Loose text (a list item without a paragraph, or text outside any
      // block): it gets a paragraph of its own. Whitespace between blocks is
      // markup, not content.
      if (!inPre && text.trim() === "") return;
      open(inPre ? "code" : "p");
    }
    const style = { ...marks[marks.length - 1] };
    if (mention) style.mention = mention;
    const block = current as Block;
    const last = block.runs[block.runs.length - 1];
    if (last && !last.mention && !style.mention && sameMarks(last, style)) last.text += text;
    else block.runs.push({ text, ...style });
  };

  for (const token of tokens) {
    if (token[0] !== "<") {
      addText(decodeEntities(inPre ? token : token.replace(/\s+/g, " ")));
      continue;
    }
    const tag = parseTag(token);
    if (!tag) continue;
    const { name } = tag;

    if (mention) {
      if (name === "span") mentionDepth += tag.closing ? -1 : tag.selfClosing ? 0 : 1;
      if (mentionDepth === 0) mention = null;
      continue;
    }

    if (name === "span" && !tag.closing) {
      const type = tag.attrs["data-type"];
      if (type === "mention" || type === "invoiceMention") {
        const kind: MentionKind = type === "mention" ? "person" : "invoice";
        const id = tag.attrs["data-id"] ?? tag.attrs["data-mention-id"] ?? tag.attrs["data-invoice-id"] ?? "";
        mention = { kind, id, deleted: tag.attrs["data-deleted"] === "true" };
        mentionDepth = tag.selfClosing ? 0 : 1;
        if (tag.selfClosing) {
          addText(tag.attrs["data-label"] ?? "");
          mention = null;
        }
        continue;
      }
    }

    if (name in BLOCK_TAGS) {
      if (tag.closing) close();
      else open(BLOCK_TAGS[name]);
      continue;
    }

    switch (name) {
      case "ul":
      case "ol":
        if (tag.closing) {
          close();
          lists.pop();
        } else {
          close();
          const start = Number(tag.attrs.start);
          lists.push({ ordered: name === "ol", next: Number.isFinite(start) && start > 0 ? start : 1 });
        }
        continue;
      case "li":
        if (tag.closing) {
          close();
          pendingMarker = null;
        } else {
          close();
          const list = lists[lists.length - 1];
          if (list) pendingMarker = list.ordered ? `${list.next++}.` : "•";
        }
        continue;
      case "blockquote":
        close();
        quote += tag.closing ? -1 : 1;
        if (quote < 0) quote = 0;
        continue;
      case "pre":
        if (tag.closing) {
          close();
          inPre = false;
        } else {
          open("code");
          inPre = true;
        }
        continue;
      case "hr":
        close();
        blocks.push({ kind: "hr", runs: [], ...context() });
        continue;
      case "br":
        addText("\n");
        continue;
    }

    const mark = MARK_TAGS[name];
    if (mark) {
      // Inside a code block, <code> is the block itself, not a mark.
      if (inPre && name === "code") continue;
      if (tag.closing) {
        if (marks.length > 1) marks.pop();
      } else if (!tag.selfClosing) {
        marks.push({ ...marks[marks.length - 1], [mark]: true });
      }
    }
  }
  close();

  // A trailing hard break in a paragraph draws an empty last line; drop it.
  for (const b of blocks) {
    const last = b.runs[b.runs.length - 1];
    if (last && !last.mention && last.text.endsWith("\n") && b.kind !== "code") {
      last.text = last.text.slice(0, -1);
      if (!last.text) b.runs.pop();
    }
  }
  return blocks;
}

function sameMarks(a: Marks, b: Marks): boolean {
  const keys: (keyof Marks)[] = ["bold", "italic", "underline", "strike", "code", "highlight", "link"];
  return keys.every((k) => !!a[k] === !!b[k]);
}

/** Whether an idea has anything to draw (a card with none shows its placeholder). */
export function hasContent(blocks: Block[]): boolean {
  return blocks.some((b) => b.kind === "hr" || b.runs.some((r) => r.text.trim() !== ""));
}
