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
