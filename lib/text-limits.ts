/**
 * How long a note's words may be — the same limits for the web, the API, the
 * phone's sync and the phone itself. No imports: the phone reads this file
 * through `@shared/text-limits`, so both ends check one definition.
 *
 * Counted in UTF-16 code units, which is what String#length and Zod's .max()
 * count on both ends. The text limit is generous — a long note is tens of
 * thousands of characters of HTML — and it is what bounds one request, one
 * row and one sync answer: without it, one oversized note fits in a single
 * push and can be echoed back hundreds of times.
 */

/** An issue's title. */
export const ISSUE_TITLE_MAX = 500;

/** A rich text: an issue's description, an idea's content. Characters of HTML. */
export const RICH_TEXT_MAX = 200_000;

/** An agent's log on an issue (IssueAgentState.log). Characters of markdown. */
export const AGENT_LOG_MAX = 200_000;

/** One entry an agent adds to its log at a time (issue_write_log). */
export const AGENT_LOG_ENTRY_MAX = 4_000;

/**
 * An agent's note as it sends it, in markdown (issue_update_note). Far under
 * RICH_TEXT_MAX: the note is the latest pass and does not grow, and the
 * markdown parser is quadratic on some inputs (lib/rich-text/markdown.ts).
 */
export const AGENT_NOTE_MARKDOWN_MAX = 20_000;

/** The folder an agent works in, or the link to its session. */
export const AGENT_REF_MAX = 2_000;
