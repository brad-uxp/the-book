import { formatInTimeZone } from "date-fns-tz";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { TZ } from "@/lib/dates";
import { ARCHIVED_STATUS, isArchived, type IssueStatus } from "@/lib/issues";
import { checkShapeChange, isBlankHtml } from "@/lib/notes";
import { SEED_NODE_HEIGHT, SEED_NODE_WIDTH } from "@/lib/note-canvas";
import { agentHtml } from "@/lib/rich-text/markdown";
import { textHash, type IssuePatch } from "@/lib/sync";
import { AGENT_LOG_MAX, RICH_TEXT_MAX } from "@/lib/text-limits";

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
 *
 * What the writer may change is decided here too, not in the routes: an
 * agent's token (`access: "agent"`) gets a 403 for anything but its own
 * fields — see "What an agent may do" below — whichever way it came in.
 */

export type Db = Prisma.TransactionClient;
export type AuditEntry = Parameters<typeof auditLog>[0];

/**
 * What the writer may change. `agent` is a token of kind `agent`: it works an
 * issue, it does not own it. Everyone else — the browser, the phone, a
 * script's automation token — is the owner.
 */
export type Access = "owner" | "agent";

export interface Writer {
  /** Who is writing: an email, or `token:<kind>:<name> (<prefix>)` for an API token. */
  actor: string | null;
  access: Access;
}

export interface WriteContext extends Writer {
  audit: (entry: AuditEntry) => void;
}

/** Runs `fn` in one transaction and writes its audit entries after the commit. */
export async function inTransaction<T>(
  writer: Writer,
  fn: (tx: Db, ctx: WriteContext) => Promise<T>
): Promise<T> {
  const entries: AuditEntry[] = [];
  const result = await prisma.$transaction((tx) =>
    fn(tx, { actor: writer.actor, access: writer.access, audit: (e) => entries.push(e) })
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

// ── What an agent may do ─────────────────────────────────────────────────────

/**
 * The fields an agent may write on an issue: its note and how far along the
 * work is. The title, description, due date, client, kind and order are the
 * owner's — an agent proposes in its note, it does not rewrite the brief.
 */
const AGENT_FIELDS: ReadonlySet<string> = new Set(["agent_note", "progress", "status"]);

/**
 * The statuses an agent may set. Never `done`: archiving is the owner's call,
 * and it is this check, not an agent's prompt, that keeps it so. Never
 * `pending` either: the backlog is the owner's to fill.
 */
export const AGENT_STATUSES = ["in_progress", "review", "blocked"] as const satisfies readonly IssueStatus[];

function forbidden(error: string) {
  return { ok: false, status: 403, error } as const;
}

/** Why an agent may not apply `patch`, or null when it may. */
function agentPatchRefusal(patch: IssueUpdate): string | null {
  const others = Object.keys(patch).filter((key) => !AGENT_FIELDS.has(key));
  if (others.length > 0) return `An agent cannot change ${others.join(", ")}`;
  if (patch.status !== undefined && !(AGENT_STATUSES as readonly IssueStatus[]).includes(patch.status)) {
    return patch.status === ARCHIVED_STATUS
      ? "Only the owner can mark an issue done"
      : `An agent cannot set the status to ${patch.status}`;
  }
  return null;
}

/** Once the owner has archived an issue, an agent writes nothing more to it — not even to reopen it. */
const ARCHIVED_REFUSAL = "This issue is archived; only the owner can reopen it";

/**
 * An agent works epics, which are tasks. A note is the owner's own writing:
 * the issue routes do not even show one to an agent, and it writes none.
 */
const NOTE_REFUSAL = "An agent works tasks, not notes";

/** Why an agent may not write to this issue at all, or null when it may. */
function agentIssueRefusal(issue: { category: string; status: string }): string | null {
  if (issue.category !== "task") return NOTE_REFUSAL;
  if (isArchived(issue)) return ARCHIVED_REFUSAL;
  return null;
}

/** agentIssueRefusal as a where-clause, for the write itself to check again. */
const AGENT_WRITABLE = { category: "task", status: { not: ARCHIVED_STATUS } } as const;

const CONFLICT = {
  ok: false,
  status: 409,
  error: "The note or the description changed since you read it",
} as const;

/**
 * The version of an issue an agent read: its note and its description, each
 * as a short textHash. An agent writes its note with the version it read;
 * if the owner changed either since, the write is a 409 and the agent reads
 * again — so its note never overwrites an answer it has not seen, and the
 * description it is recorded as having seen is the one it actually read.
 * Never `updated_at`: any edit at all moves it.
 */
export function agentBase(issue: { agent_note: string; description: string }): string {
  return `${textHash(issue.agent_note).slice(0, 16)}.${textHash(issue.description).slice(0, 16)}`;
}

/**
 * Reads an issue and locks its row until the transaction ends (call it inside
 * inTransaction), so what is checked about it still holds when the write
 * lands: the owner archiving it in the same instant waits, or is seen.
 */
async function lockIssue(db: Db, id: string) {
  const rows = await db.$queryRaw<{ title: string; category: string; status: string }[]>`
    SELECT title, category::text AS category, status::text AS status
    FROM "Task" WHERE id = ${id} FOR UPDATE`;
  return rows[0] ?? null;
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
  status?: IssueStatus;
  progress?: number;
  due_date?: string | null;
  description?: string;
  sort_order?: number;
}

/**
 * An edit: what the phone's sync may push (IssuePatch), plus the agent's note,
 * which the phone does not carry.
 */
export interface IssueUpdate extends IssuePatch {
  agent_note?: string;
}

/**
 * Creates an issue. Throws Prisma's errors (a taken id is P2002, a client that
 * does not exist P2025) for the caller to map. An agent cannot: the owner
 * decides what the work is.
 */
export async function createIssue(db: Db, input: IssueCreate, ctx: WriteContext) {
  if (ctx.access === "agent") return forbidden("An agent cannot create issues");

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
 *
 * An agent may change only its note, the progress and some statuses, only on
 * a task, and nothing once it is archived — checked first, and again inside
 * the write itself, so the owner archiving it in the same instant is never
 * undone. With `opts.base` (agentBase), an agent's write also lands only if
 * the note and the description are still the ones it read (409 otherwise).
 * When an agent writes its note, the server keeps that note and the
 * description as they stand (IssueAgentState): what the owner changes after
 * is measured against them.
 */
export async function updateIssue(
  db: Db,
  id: string,
  patch: IssueUpdate,
  ctx: WriteContext,
  opts: { base?: string } = {}
) {
  const agent = ctx.access === "agent";
  if (agent) {
    const refusal = agentPatchRefusal(patch);
    if (refusal) return forbidden(refusal);
  }

  const has = (key: keyof IssueUpdate) => Object.hasOwn(patch, key);

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
  if (has("agent_note")) {
    // An agent's note is held to the editor's schema without chips, however
    // it arrived: the MCP sends it so already, the REST API takes HTML — and
    // a chip an agent planted would come back with an invoice's amount.
    data.agent_note = agent ? agentHtml(patch.agent_note ?? "") : patch.agent_note;
    if (agent && (data.agent_note as string).length > RICH_TEXT_MAX) {
      return { ok: false, status: 400, error: "Note too long" } as const;
    }
  }
  if (has("sort_order")) data.sort_order = patch.sort_order;

  const before = await db.issue.findUnique({ where: { id } });
  if (!before) return { ok: false, status: 404, error: "Not found" } as const;
  if (agent) {
    const refusal = agentIssueRefusal(before);
    if (refusal) return forbidden(refusal);
    if (opts.base !== undefined && opts.base !== agentBase(before)) return CONFLICT;
  }

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

  let issue;
  if (agent) {
    // The checks above, made again by the write: if the owner archived the
    // issue, or changed what the agent read, between the read and here, no
    // row matches and nothing is written. An agent writes scalars only
    // (AGENT_FIELDS), so updateMany takes its data as it is.
    const { count } = await db.issue.updateMany({
      where: {
        id,
        ...AGENT_WRITABLE,
        ...(opts.base !== undefined ? { agent_note: before.agent_note, description: before.description } : {}),
      },
      data: data as Prisma.IssueUpdateManyMutationInput,
    });
    if (count === 0) {
      const now = await db.issue.findUnique({ where: { id }, select: { category: true, status: true } });
      if (!now) return { ok: false, status: 404, error: "Not found" } as const;
      const refusal = agentIssueRefusal(now);
      return refusal ? forbidden(refusal) : CONFLICT;
    }
    issue = await db.issue.findUniqueOrThrow({ where: { id }, include: { client: true } });
  } else {
    issue = await db.issue.update({ where: { id }, data, include: { client: true } });
  }
  if (seed !== null) {
    await db.canvasNode.create({
      data: { issue_id: id, content: seed, x: 0, y: 0, width: SEED_NODE_WIDTH, height: SEED_NODE_HEIGHT },
    });
  }
  if (agent && has("agent_note")) {
    const seen = { last_note: issue.agent_note, description_seen: issue.description };
    await db.issueAgentState.upsert({
      where: { issue_id: id },
      create: { issue_id: id, ...seen },
      update: seen,
    });
  }

  ctx.audit({
    entity_type: "issue",
    entity_id: id,
    entity_name: issue.title,
    action: "update",
    actor_email: ctx.actor,
    before: auditState(before),
    // Which fields were written: a write of the note alone (or the
    // description) leaves before and after the same otherwise.
    after: { ...auditState(issue), changed: Object.keys(patch) },
  });

  return { ok: true, value: issue } as const;
}

/**
 * Deletes an issue, and by cascade its ideas and connections. The database
 * records each of those deletions for the phone (SyncTombstone triggers).
 * An agent cannot.
 */
export async function deleteIssue(db: Db, id: string, ctx: WriteContext) {
  if (ctx.access === "agent") return forbidden("An agent cannot delete issues");

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

export interface AgentStatePatch {
  log?: string;
  work_dir?: string | null;
  session_url?: string | null;
}

/**
 * Writes what an agent keeps about an issue between passes: its log, its
 * folder, its session — the fields present in `patch`, and only those. The
 * owner may write them too; an agent, only on a task not yet archived.
 *
 * The note an agent last wrote and the description it last saw are not
 * here: updateIssue keeps them when an agent writes its note, so they always
 * say what the server actually had. To add to the log, appendAgentLog.
 */
export async function updateAgentState(db: Db, issueId: string, patch: AgentStatePatch, ctx: WriteContext) {
  const issue = await lockIssue(db, issueId);
  if (!issue) return { ok: false, status: 404, error: "Not found" } as const;
  if (ctx.access === "agent") {
    const refusal = agentIssueRefusal(issue);
    if (refusal) return forbidden(refusal);
  }

  const data: Prisma.IssueAgentStateUpdateWithoutIssueInput = {};
  if (Object.hasOwn(patch, "log")) data.log = patch.log;
  if (Object.hasOwn(patch, "work_dir")) data.work_dir = patch.work_dir;
  if (Object.hasOwn(patch, "session_url")) data.session_url = patch.session_url;

  const state = await db.issueAgentState.upsert({
    where: { issue_id: issueId },
    create: { issue_id: issueId, ...(data as Omit<Prisma.IssueAgentStateUncheckedCreateInput, "issue_id">) },
    update: data,
  });

  // Like the issue's own entries: which fields, not the log's text.
  ctx.audit({
    entity_type: "issue",
    entity_id: issueId,
    entity_name: issue.title,
    action: "update",
    actor_email: ctx.actor,
    after: { agent_state: { changed: Object.keys(data), work_dir: state.work_dir, session_url: state.session_url } },
  });

  return { ok: true, value: state } as const;
}

/**
 * Adds one entry to an issue's log, stamped with the time in Montevideo, and
 * drops the oldest whole lines once the log passes `max` (AGENT_LOG_MAX). The
 * server adds, so an agent never reads the whole log back to write a line,
 * and a long epic never hits the limit halfway: it forgets its beginning.
 *
 * The issue's row stays locked until the transaction ends, so two entries
 * written at once both land, in order. Same rules as updateAgentState.
 */
export async function appendAgentLog(
  db: Db,
  issueId: string,
  entry: string,
  ctx: WriteContext,
  { now = new Date(), max = AGENT_LOG_MAX }: { now?: Date; max?: number } = {}
) {
  const issue = await lockIssue(db, issueId);
  if (!issue) return { ok: false, status: 404, error: "Not found" } as const;
  if (ctx.access === "agent") {
    const refusal = agentIssueRefusal(issue);
    if (refusal) return forbidden(refusal);
  }

  const line = `[${formatInTimeZone(now, TZ, "yyyy-MM-dd HH:mm")}] ${entry.trim()}`;
  const current = await db.issueAgentState.findUnique({ where: { issue_id: issueId }, select: { log: true } });
  const log = trimLog(current?.log ? `${current.log}\n${line}` : line, max);
  await db.issueAgentState.upsert({
    where: { issue_id: issueId },
    create: { issue_id: issueId, log },
    update: { log },
  });

  ctx.audit({
    entity_type: "issue",
    entity_id: issueId,
    entity_name: issue.title,
    action: "update",
    actor_email: ctx.actor,
    after: { agent_state: { changed: ["log"] } },
  });

  return { ok: true, value: { log } } as const;
}

/** The last `max` characters of a log, from the start of a line. */
export function trimLog(log: string, max: number): string {
  if (log.length <= max) return log;
  const start = log.length - max;
  if (log[start - 1] === "\n") return log.slice(start);
  const cut = log.indexOf("\n", start);
  return cut === -1 ? log.slice(start) : log.slice(cut + 1);
}
