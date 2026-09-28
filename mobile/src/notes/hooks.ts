import { useMemo } from "react";
import { useLiveQuery } from "@/db/database";
import type { LocalIssue } from "@/sync/merge";
import { kindOf, type Filter } from "@/lib/issues";
import { fold } from "./text";

/**
 * What the screens read — from SQLite only, re-read whenever the tables they
 * depend on are written (by the person or by the sync).
 */

export interface Client {
  id: string;
  name: string;
  color_hex: string;
}

export interface NoteListItem
  extends Pick<
    LocalIssue,
    "id" | "title" | "category" | "note_format" | "status" | "progress" | "due_date" | "description" | "updated_at" | "sync_error"
  > {
  client: Pick<Client, "name" | "color_hex"> | null;
  ideas: number;
  connections: number;
  /** Changes to it are still waiting for the server. */
  pending: boolean;
}

type ListRecord = Omit<NoteListItem, "client" | "pending"> & {
  client_name: string | null;
  client_color: string | null;
  pending: number;
};

/**
 * The home list: everything not archived, most recently edited first. The
 * description is cut to what a two-line snippet needs.
 */
export function useNotesList(query: string) {
  const needle = fold(query.trim());
  const rows = useLiveQuery(
    ["issues", "canvas_nodes", "canvas_edges", "refs", "outbox"],
    async (db) => {
      const like = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return db.getAllAsync<ListRecord>(
        `SELECT i.id, i.title, i.category, i.note_format, i.status, i.progress, i.due_date,
                substr(i.description, 1, 2000) AS description, i.updated_at, i.sync_error,
                c.name AS client_name, c.color_hex AS client_color,
                (SELECT count(*) FROM canvas_nodes n WHERE n.issue_id = i.id) AS ideas,
                (SELECT count(*) FROM canvas_edges e WHERE e.issue_id = i.id) AS connections,
                EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'issue' AND o.entity_id = i.id) AS pending
         FROM issues i LEFT JOIN clients c ON c.id = i.client_id
         WHERE i.deleted_at IS NULL AND i.announced = 1
           AND NOT (i.category = 'task' AND i.status = 'done')
           ${needle ? "AND (i.search LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM canvas_nodes n WHERE n.issue_id = i.id AND n.search LIKE ? ESCAPE '\\'))" : ""}
         ORDER BY i.updated_at DESC`,
        needle ? [like, like] : []
      );
    },
    [needle]
  );

  return useMemo(() => {
    if (!rows) return undefined;
    return rows.map(
      (r): NoteListItem => ({
        ...r,
        client: r.client_name ? { name: r.client_name, color_hex: r.client_color ?? "#71717A" } : null,
        pending: !!r.pending,
      })
    );
  }, [rows]);
}

export function countByKind(items: NoteListItem[]): Record<Filter, number> {
  const c = { all: 0, note: 0, canvas: 0, task: 0 };
  for (const i of items) {
    c.all += 1;
    c[kindOf(i)] += 1;
  }
  return c;
}

/** One note, live; null once it is gone (deleted here or on the server). */
export function useIssue(id: string) {
  return useLiveQuery(
    ["issues", "outbox"],
    async (db) =>
      (await db.getFirstAsync<LocalIssue & { pending: number }>(
        `SELECT i.*, EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'issue' AND o.entity_id = i.id) AS pending
         FROM issues i WHERE i.id = ?`,
        id
      )) ?? null,
    [id]
  );
}

export function useClients(): Client[] {
  return useLiveQuery(["refs"], (db) => db.getAllAsync<Client>("SELECT * FROM clients ORDER BY name COLLATE NOCASE"), []) ?? [];
}

export interface PersonRef {
  id: string;
  name: string;
  role: string | null;
  status: "active" | "inactive";
}

export interface InvoiceRef {
  id: string;
  invoice_number: string | null;
  client_name: string;
  status: string;
  amount_cents: number;
}

export function usePeople(): PersonRef[] {
  return useLiveQuery(["refs"], (db) => db.getAllAsync<PersonRef>("SELECT * FROM people ORDER BY name COLLATE NOCASE"), []) ?? [];
}

export function useInvoices(): InvoiceRef[] {
  return useLiveQuery(["refs"], (db) => db.getAllAsync<InvoiceRef>("SELECT * FROM invoices"), []) ?? [];
}

export interface Idea {
  id: string;
  content: string;
  color: string | null;
  x: number;
  y: number;
  links: number;
}

/** A canvas note's ideas in reading order — top to bottom, then left to right. */
export function useIdeas(issueId: string): Idea[] | undefined {
  return useLiveQuery(
    ["canvas_nodes", "canvas_edges"],
    (db) =>
      db.getAllAsync<Idea>(
        `SELECT n.id, n.content, n.color, n.x, n.y,
                (SELECT count(*) FROM canvas_edges e WHERE e.source_id = n.id OR e.target_id = n.id) AS links
         FROM canvas_nodes n WHERE n.issue_id = ? ORDER BY n.y, n.x`,
        issueId
      ),
    [issueId]
  );
}

/** Whether the phone has ever finished a pull — before that, an empty list means "not yet". */
export function useHasSynced(): boolean | undefined {
  return useLiveQuery(
    ["meta"],
    async (db) => !!(await db.getFirstAsync("SELECT 1 FROM meta WHERE key = 'sync.cursor'")),
    []
  );
}
