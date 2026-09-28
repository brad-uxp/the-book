import { mentionNeedle } from "@shared/mentions";
import { useLiveQuery } from "@/db/database";

/**
 * The notes on this phone that mention an invoice with #: in their text or,
 * for a canvas, in one of its ideas. The same "linked issues" the web shows,
 * found in the local copy — so it works without signal.
 */
export interface LinkedIssue {
  id: string;
  title: string;
  category: "task" | "note";
  note_format: "text" | "canvas";
  status: string;
  description: string;
}

export function useLinkedIssues(invoiceId: string): LinkedIssue[] | undefined {
  return useLiveQuery(
    ["issues", "canvas_nodes"],
    async (db) => {
      const like = `%${mentionNeedle("invoice", invoiceId).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      return db.getAllAsync<LinkedIssue>(
        `SELECT i.id, i.title, i.category, i.note_format, i.status, substr(i.description, 1, 2000) AS description
         FROM issues i
         WHERE i.deleted_at IS NULL AND i.announced = 1
           AND (i.description LIKE ? ESCAPE '\\'
                OR EXISTS (SELECT 1 FROM canvas_nodes n WHERE n.issue_id = i.id AND n.content LIKE ? ESCAPE '\\'))
         ORDER BY i.updated_at DESC`,
        [like, like]
      );
    },
    [invoiceId]
  );
}
