/**
 * What a note says, as the phone needs it outside the editor: a title when
 * none was typed, a line of text to search, whether anything was written.
 *
 * Pure and dependency-free (relative imports with the extension), so it runs
 * under `node --test` as well as in the app.
 */
import { plainTextSnippet } from "../../../lib/mentions.ts";
import { isBlankHtml } from "../../../lib/notes.ts";
import { ISSUE_TITLE_MAX, RICH_TEXT_MAX } from "../../../lib/text-limits.ts";

export { isBlankHtml };

/** The longest title a note gets from its first line. */
const DERIVED_TITLE_MAX = 80;

/**
 * The title the server stores. A title is required there; on the phone it is
 * not — like Apple Notes, a note without one is named by its first line.
 */
export function effectiveTitle(title: string, html: string): string {
  const typed = title.trim().slice(0, ISSUE_TITLE_MAX);
  if (typed) return typed;
  const firstLine = firstTextLine(html);
  return firstLine ? plainTextSnippet(firstLine, DERIVED_TITLE_MAX) : "Untitled";
}

/** The text of the first block that has any. */
export function firstTextLine(html: string): string {
  for (const block of html.split(/<\/(?:p|h[1-6]|li|blockquote)>|<br\s*\/?>/i)) {
    const text = plainTextSnippet(block, 10_000);
    if (text) return text;
  }
  return "";
}

/** Nothing typed anywhere: what makes a new note discardable. */
export function isBlankNote(title: string, html: string): boolean {
  return title.trim() === "" && isBlankHtml(html);
}

/**
 * Lowercased, accent-folded text for local search, so "perez" finds "Pérez".
 * Mentions are text in the HTML (their label), so they are searchable too.
 */
export function fold(text: string): string {
  const base = typeof text.normalize === "function" ? text.normalize("NFD") : text;
  return base.replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function searchText(title: string, html: string): string {
  return fold(`${title} ${plainTextSnippet(html, 1_000_000)}`);
}

/** An idea's text as separate lines — how the read-only canvas list shows it. */
export function textLines(html: string): string[] {
  return html
    .split(/<\/(?:p|h[1-6]|li|blockquote)>|<br\s*\/?>/i)
    .map((block) => plainTextSnippet(block, 10_000))
    .filter((line) => line !== "");
}

/**
 * Whether a note's text is past what the server accepts (lib/text-limits.ts).
 * Such a text stays on the phone, flagged, until it is shortened.
 */
export function textTooLong(html: string): boolean {
  return html.length > RICH_TEXT_MAX;
}
