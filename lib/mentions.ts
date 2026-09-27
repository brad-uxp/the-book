/**
 * @person and #invoice mentions, as they sit in editor HTML.
 *
 * "Linked issues" on a person or an invoice is not a relation in the
 * database: it is these attributes, found inside the rich text of an issue's
 * description — and, since a note can be a canvas, inside the rich text of
 * each idea on it.
 */

export const MENTION_ATTR = {
  person: "data-mention-id",
  invoice: "data-invoice-id",
} as const;

export type MentionKind = keyof typeof MENTION_ATTR;

/** The exact substring that marks a mention of `id`, for a `contains` query. */
export function mentionNeedle(kind: MentionKind, id: string): string {
  return `${MENTION_ATTR[kind]}="${id}"`;
}

/**
 * How many issues mention each entity, from every piece of rich text that
 * belongs to them.
 *
 * Counted per issue, not per occurrence: a person mentioned in the
 * description and in three ideas of the same canvas is one linked issue,
 * which is what the badge on their row means.
 */
export function countMentions(
  docs: Iterable<{ issue_id: string; html: string }>,
  kind: MentionKind
): Record<string, number> {
  const re = new RegExp(`${MENTION_ATTR[kind]}="([^"]+)"`, "g");
  const byIssue = new Map<string, Set<string>>();

  for (const doc of docs) {
    let seen = byIssue.get(doc.issue_id);
    for (const match of doc.html.matchAll(re)) {
      if (!seen) {
        seen = new Set();
        byIssue.set(doc.issue_id, seen);
      }
      seen.add(match[1]);
    }
  }

  const counts: Record<string, number> = {};
  for (const ids of byIssue.values()) {
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&#160;": " ",
};

/**
 * A short, readable line from editor HTML — for an audit entry, where the
 * name has to say which idea was removed months later without opening it.
 */
export function plainTextSnippet(html: string, max = 60): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp|#160);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The word a mention chip carries once its person or invoice is gone.
 *
 * The label is written into the stored HTML, so older notes still say
 * " (eliminado)" from when the UI was in Spanish. Both are recognised and
 * replaced, so a note is normalised the next time it is opened and a chip
 * never ends up with two suffixes.
 */
export const DELETED_MENTION_SUFFIX = " (deleted)";
const DELETED_SUFFIXES = [" (deleted)", " (eliminado)"];

export function stripDeletedSuffix(label: string): string {
  let out = label;
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of DELETED_SUFFIXES) {
      if (out.endsWith(suffix)) {
        out = out.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return out;
}

export function deletedMentionLabel(label: string): string {
  return stripDeletedSuffix(label) + DELETED_MENTION_SUFFIX;
}
