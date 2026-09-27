import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { checkShapeChange, isBlankHtml } from "@/lib/notes";
import { SEED_NODE_HEIGHT, SEED_NODE_WIDTH } from "@/lib/note-canvas";
import type { IssuePatch } from "@/lib/sync";

/**
 * Writing issues: create, edit, delete — the rules and the audit trail in one
 * place, for both ways in. The REST routes (/api/issues) and the phone's sync
 * (/api/sync/notes) call these, so a change made from the phone is validated,
 * shaped and audited exactly like one made on the web.
 *
 * Every function takes the client to write with — a transaction when the
 * caller needs several writes to land together — and a WriteContext whose
 * `audit` it calls instead of writing the log itself. Use `inTransaction`,
 * which hands both over and writes the log only once the transaction has
 * committed: a rolled-back change must not leave a record saying it happened.
 */

export type Db = Prisma.TransactionClient;
export type AuditEntry = Parameters<typeof auditLog>[0];

export interface WriteContext {
  /** Who is writing: an email, or `token:<name>` for an API token (the phone). */
  actor: string | null;
  audit: (entry: AuditEntry) => void;
}

/** Runs `fn` in one transaction and writes its audit entries after the commit. */
export async function inTransaction<T>(
  actor: string | null,
  fn: (tx: Db, ctx: WriteContext) => Promise<T>
): Promise<T> {
  const entries: AuditEntry[] = [];
  const result = await prisma.$transaction((tx) =>
    fn(tx, { actor, audit: (e) => entries.push(e) })
  );
  for (const entry of entries) auditLog(entry);
  return result;
}

/** What the audit log keeps of an issue: its fields, not its text. */
function auditState(issue: {
  title: string;
  client_id: string | null;
  category: string;
  note_format: string;
  status: string;
  progress: number;
  due_date: Date | null;
}) {
  return {
    title: issue.title,
    client_id: issue.client_id,
    category: issue.category,
    note_format: issue.note_format,
    status: issue.status,
    progress: issue.progress,
    due_date: issue.due_date,
  };
}

/**
 * The keys of `raw` that the client actually sent, with their parsed values.
 *
 * Zod's .default() fills in values even under .partial(), which would
 * overwrite fields the client never sent (status → "pending" on every
 * description edit). The raw body decides WHICH fields change; the parse
 * decides what they change to.
 */
export function pickSent<T extends object>(raw: unknown, parsed: T): Partial<T> {
  const out: Partial<T> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(raw)) {
    if (Object.hasOwn(parsed, key)) out[key as keyof T] = parsed[key as keyof T];
  }
  return out;
}

export interface IssueCreate {
  /** A UUID chosen by the client (the phone creates notes offline). A duplicate is a P2002. */
  id?: string;
  title: string;
  client_id?: string | null;
  category?: "task" | "note";
  note_format?: "text" | "canvas";
  status?: "pending" | "in_progress" | "blocked" | "done";
  progress?: number;
  due_date?: string | null;
  description?: string;
  sort_order?: number;
}

/**
 * Creates an issue. Throws Prisma's errors (a taken id is P2002, a client that
 * does not exist P2025) for the caller to map.
 */
export async function createIssue(db: Db, input: IssueCreate, ctx: WriteContext) {
  const shape = checkShapeChange(null, {
    category: input.category ?? "task",
    note_format: input.note_format ?? "text",
  });
  if (!shape.ok) {
    return { ok: false, status: shape.status, error: shape.error } as const;
  }

  const clientId = input.client_id ?? null;
  const issue = await db.issue.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      category: input.category ?? "task",
      note_format: input.note_format ?? "text",
      status: input.status ?? "pending",
      progress: input.progress ?? 0,
      due_date: input.due_date ? new Date(input.due_date) : null,
      description: input.description ?? "",
      sort_order: input.sort_order ?? 0,
      ...(clientId ? { client: { connect: { id: clientId } } } : {}),
    },
    include: { client: true },
  });

  ctx.audit({
    entity_type: "issue",
    entity_id: issue.id,
    entity_name: issue.title,
    action: "create",
    actor_email: ctx.actor,
    after: auditState(issue),
  });

  return { ok: true, value: issue } as const;
}

/**
 * Edits the fields present in `patch` — and only those: a key that is absent
 * is left alone, a key set to null clears it.
 *
 * Turning a text note into a canvas moves its description into the first idea,
 * in the same transaction, so the words are never in neither place (see
 * lib/notes.ts for which shape changes exist).
 */
export async function updateIssue(db: Db, id: string, patch: IssuePatch, ctx: WriteContext) {
  const has = (key: keyof IssuePatch) => Object.hasOwn(patch, key);

  const data: Prisma.IssueUpdateInput = {};
  if (has("title")) data.title = patch.title;
  if (has("client_id")) {
    data.client = patch.client_id ? { connect: { id: patch.client_id } } : { disconnect: true };
  }
  if (has("category")) data.category = patch.category;
  if (has("note_format")) data.note_format = patch.note_format;
  if (has("status")) data.status = patch.status;
  if (has("progress")) data.progress = patch.progress;
  if (has("due_date")) data.due_date = patch.due_date ? new Date(patch.due_date) : null;
  if (has("description")) data.description = patch.description;
  if (has("sort_order")) data.sort_order = patch.sort_order;

  const before = await db.issue.findUnique({ where: { id } });
  if (!before) return { ok: false, status: 404, error: "Not found" } as const;

  // Checked against the row as stored, since the client may send only one
  // half of the shape.
  const shape = checkShapeChange(before, {
    category: patch.category ?? before.category,
    note_format: patch.note_format ?? before.note_format,
  });
  if (!shape.ok) return { ok: false, status: shape.status, error: shape.error } as const;

  // A text note becoming a canvas: what it said becomes its first idea. The
  // description is emptied — a canvas does not show one, and a stale copy
  // would keep answering "linked issues" for mentions the user has since
  // removed from the idea.
  let seed: string | null = null;
  if (shape.seedFromDescription) {
    const description = has("description") ? (patch.description ?? "") : before.description;
    if (!isBlankHtml(description)) seed = description;
    data.description = "";
  }

  const issue = await db.issue.update({ where: { id }, data, include: { client: true } });
  if (seed !== null) {
    await db.canvasNode.create({
      data: { issue_id: id, content: seed, x: 0, y: 0, width: SEED_NODE_WIDTH, height: SEED_NODE_HEIGHT },
    });
  }

  ctx.audit({
    entity_type: "issue",
    entity_id: id,
    entity_name: issue.title,
    action: "update",
    actor_email: ctx.actor,
    before: auditState(before),
    after: auditState(issue),
  });

  return { ok: true, value: issue } as const;
}

/**
 * Deletes an issue, and by cascade its ideas and connections. The database
 * records each of those deletions for the phone (SyncTombstone triggers).
 */
export async function deleteIssue(db: Db, id: string, ctx: WriteContext) {
  const before = await db.issue.findUnique({ where: { id } });
  if (!before) return { ok: false, status: 404, error: "Not found" } as const;

  await db.issue.delete({ where: { id } });

  ctx.audit({
    entity_type: "issue",
    entity_id: id,
    entity_name: before.title,
    action: "delete",
    actor_email: ctx.actor,
    before: auditState(before),
  });

  return { ok: true, value: before } as const;
}
