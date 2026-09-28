// Shared with the web, so both apps agree on what "canvas" means.
import { isCanvasNote } from "@shared/notes";
import { plainTextSnippet } from "@shared/mentions";

export type Kind = "note" | "canvas" | "task";
export type Filter = "all" | Kind;

export function kindOf(issue: { category: "task" | "note"; note_format: "text" | "canvas" }): Kind {
  if (issue.category === "task") return "task";
  return isCanvasNote(issue) ? "canvas" : "note";
}

export function snippetOf(issue: { description: string }): string {
  return plainTextSnippet(issue.description, 140);
}
