/**
 * What a note is made of, and which changes to that are allowed.
 *
 * A note is either one rich-text document (`text`) or a canvas of connected
 * ideas (`canvas`). Only notes can be canvases — the database refuses a canvas
 * task with a CHECK — because everything that keeps a canvas off the board,
 * out of the archive and away from the daily job is keyed on
 * `category = note`.
 */

export const NOTE_FORMATS = ["text", "canvas"] as const;
export type NoteFormat = (typeof NOTE_FORMATS)[number];

export interface IssueShape {
  category: "task" | "note";
  note_format: NoteFormat;
}

export type ShapeChange =
  | {
      ok: true;
      /**
       * A text note just became a canvas. Its description becomes the first
       * idea on the canvas, so converting never loses what was written.
       */
      seedFromDescription: boolean;
    }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Whether an issue may take a given shape, from the one it has now.
 *
 * Pass `before = null` for an issue being created.
 *
 *  - task ↔ text note: allowed, as it always was.
 *  - text note → canvas: allowed; the description seeds the first node.
 *  - canvas → anything else: refused. Flattening a canvas into one document
 *    would throw away its connections, and a task has nowhere to keep them.
 *  - a canvas task: refused outright — it is not a shape that exists.
 */
export function checkShapeChange(
  before: IssueShape | null,
  after: IssueShape
): ShapeChange {
  // Leaving a canvas is checked first: someone converting a canvas to a task
  // should be told that, not that tasks cannot be canvases.
  if (before?.note_format === "canvas") {
    if (after.category !== "note") {
      return {
        ok: false,
        status: 409,
        error: "A canvas note cannot be converted to a task",
      };
    }
    if (after.note_format !== "canvas") {
      return {
        ok: false,
        status: 409,
        error: "A canvas note cannot be converted back to text",
      };
    }
  }

  if (after.category === "task" && after.note_format === "canvas") {
    return { ok: false, status: 400, error: "Only a note can be a canvas" };
  }

  return {
    ok: true,
    seedFromDescription:
      before !== null &&
      before.note_format === "text" &&
      after.note_format === "canvas",
  };
}

export function isCanvasNote(issue: IssueShape): boolean {
  return issue.category === "note" && issue.note_format === "canvas";
}

/**
 * True when a piece of editor HTML holds nothing a person wrote.
 *
 * An editor that was opened and emptied does not save "" — TipTap writes
 * `<p></p>` — so an empty check on the raw string would seed a canvas with an
 * empty idea nobody asked for. Mentions render their label as text, so a note
 * holding only a mention is not blank.
 */
export function isBlankHtml(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;|&#160;/g, " ")
      .trim() === ""
  );
}
