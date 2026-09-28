/**
 * TEMPORARY — goes away with the stub editor (see RichTextEditor.tsx).
 *
 * Plain text ↔ the editor's HTML, for documents made only of paragraphs.
 * Anything richer (bold, lists, headings, mentions) is not plain, and the
 * stub refuses to edit it rather than flatten it.
 */

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&#160;": " " };

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp|#160);/g, (e) => ENTITIES[e] ?? e);
}

function encode(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Only `<p>` paragraphs (with `<br>` inside) — safe to edit as plain text. */
export function isPlainHtml(html: string): boolean {
  const withoutParagraphs = html.replace(/<p>((?:[^<]|<br\s*\/?>)*)<\/p>/g, "");
  return !/[<>]/.test(withoutParagraphs);
}

export function htmlToPlain(html: string): string {
  if (!html) return "";
  const paragraphs = [...html.matchAll(/<p>((?:[^<]|<br\s*\/?>)*)<\/p>/g)].map((m) =>
    decode(m[1].replace(/<br\s*\/?>/g, "\n"))
  );
  return paragraphs.join("\n");
}

export function plainToHtml(text: string): string {
  if (text === "") return "";
  return text
    .split("\n")
    .map((line) => (line === "" ? "<p></p>" : `<p>${encode(line)}</p>`))
    .join("");
}
