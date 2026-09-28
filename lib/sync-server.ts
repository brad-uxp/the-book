import { prisma } from "@/lib/db";
import {
  SyncEdgeFieldsSchema,
  SyncIssueFieldsSchema,
  SyncMutationSchema,
  SyncNodeFieldsSchema,
} from "@/lib/validations";
import {
  SYNC_PAGE_LIMITS,
  SYNC_PUSH_BUDGET,
  conflictTitle,
  nextCursor,
  planDelete,
  planIssueUpsert,
  planNodeUpsert,
  planPull,
  type IssuePatch,
  type NodePatch,
  type PullEntity,
  type Positions,
} from "@/lib/sync";
import type {
  SyncEdgeRow,
  SyncIssueRow,
  SyncMutation,
  SyncNodeRow,
  SyncPullResponse,
  SyncRefs,
  SyncResult,
  SyncTombstoneRow,
} from "@/lib/sync-protocol";
import {
  createIssue,
  inTransaction,
  pickSent,
  updateIssue,
  deleteIssue,
  type Db,
  type WriteContext,
} from "@/lib/issues-service";
import {
  canvasOf,
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  updateNode,
} from "@/lib/canvas-service";

/**
 * The database side of the phone's note sync. The rules are in lib/sync.ts
 * (pure, tested); every write goes through the same services as the web's
 * routes, so it is validated and audited the same way.
 */

// ─── Rows on the wire ────────────────────────────────────────────────────────

const ISSUE_SELECT = {
  id: true,
  title: true,
  client_id: true,
  category: true,
  note_format: true,
  status: true,
  progress: true,
  due_date: true,
  description: true,
  sort_order: true,
  created_at: true,
  updated_at: true,
} as const;

const NODE_SELECT = {
  id: true,
  issue_id: true,
  content: true,
  color: true,
  x: true,
  y: true,
  width: true,
  height: true,
  created_at: true,
  updated_at: true,
} as const;

const EDGE_SELECT = {
  id: true,
  issue_id: true,
  source_id: true,
  target_id: true,
  created_at: true,
} as const;

/** A row as Prisma returns it: the same fields, with Dates where the wire has strings. */
type FromDb<T, K extends keyof T> = Omit<T, K> & { [P in K]: null extends T[P] ? Date | null : Date };

export function toIssueRow(r: FromDb<SyncIssueRow, "due_date" | "created_at" | "updated_at">): SyncIssueRow {
  return {
    id: r.id,
    title: r.title,
    client_id: r.client_id,
    category: r.category,
    note_format: r.note_format,
    status: r.status,
    progress: r.progress,
    due_date: r.due_date ? r.due_date.toISOString() : null,
    description: r.description,
    sort_order: r.sort_order,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export function toNodeRow(r: FromDb<SyncNodeRow, "created_at" | "updated_at">): SyncNodeRow {
  return {
    id: r.id,
    issue_id: r.issue_id,
    content: r.content,
    color: r.color,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export function toEdgeRow(r: FromDb<SyncEdgeRow, "created_at">): SyncEdgeRow {
  return {
    id: r.id,
    issue_id: r.issue_id,
    source_id: r.source_id,
    target_id: r.target_id,
    created_at: r.created_at.toISOString(),
  };
}

// ─── Pull ────────────────────────────────────────────────────────────────────

/**
 * Rows at or after `from` (the round's lower bound) and strictly after the
 * keyset position in (timestamp, id) order. Typed loosely on purpose: the same
 * shape serves four models, and Prisma checks it at run time.
 */
function window(field: "updated_at" | "created_at" | "deleted_at", from: Date | null, pos?: [number, string], id: (raw: string) => string | bigint = (s) => s) {
  const clauses: object[] = [];
  if (from) clauses.push({ [field]: { gte: from } });
  if (pos) {
    const at = new Date(pos[0]);
    clauses.push({ OR: [{ [field]: { gt: at } }, { [field]: at, id: { gt: id(pos[1]) } }] });
  }
  return { AND: clauses } as any;
}

/** A tombstone position is its bigint id; anything else restarts that list, which is harmless. */
function tombstonePosition(pos: [number, string] | undefined): [number, string] | undefined {
  return pos && /^\d{1,19}$/.test(pos[1]) ? pos : undefined;
}

/**
 * One page of what changed since `cursor`.
 *
 * Read in one REPEATABLE READ transaction, so the four lists are one snapshot:
 * a row and its own tombstone can never both appear, and a tombstone whose row
 * exists again (deleted, then restored with the same id) is left out.
 */
export async function pullNotes(cursor: string | null, now: number = Date.now()): Promise<SyncPullResponse> {
  const plan = planPull(cursor, now);
  const L = SYNC_PAGE_LIMITS;
  const tombAfter = tombstonePosition(plan.after.tombstones);

  const page = await prisma.$transaction(
    async (tx) => {
      const issues = await tx.issue.findMany({
        where: window("updated_at", plan.from, plan.after.issues),
        orderBy: [{ updated_at: "asc" }, { id: "asc" }],
        take: L.issues + 1,
        select: ISSUE_SELECT,
      });
      const nodes = await tx.canvasNode.findMany({
        where: window("updated_at", plan.from, plan.after.canvas_nodes),
        orderBy: [{ updated_at: "asc" }, { id: "asc" }],
        take: L.canvas_nodes + 1,
        select: NODE_SELECT,
      });
      const edges = await tx.canvasEdge.findMany({
        where: window("created_at", plan.from, plan.after.canvas_edges),
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        take: L.canvas_edges + 1,
        select: EDGE_SELECT,
      });
      // A full sync needs no deletions: the rows that exist are the answer.
      const tombstones = plan.from
        ? await tx.syncTombstone.findMany({
            where: window("deleted_at", plan.from, tombAfter, (s) => BigInt(s)),
            orderBy: [{ deleted_at: "asc" }, { id: "asc" }],
            take: L.tombstones + 1,
          })
        : [];

      const alive = await stillExisting(tx, tombstones.slice(0, L.tombstones));
      return { issues, nodes, edges, tombstones, alive };
    },
    { isolationLevel: "RepeatableRead" }
  );

  const positions: Positions = { ...plan.after };
  let hasMore = false;
  function take<T extends { id: string | bigint }>(name: PullEntity, rows: T[], stamp: (r: T) => Date): T[] {
    const limit = SYNC_PAGE_LIMITS[name];
    if (rows.length > limit) hasMore = true;
    const kept = rows.slice(0, limit);
    const last = kept[kept.length - 1];
    if (last) positions[name] = [stamp(last).getTime(), String(last.id)];
    return kept;
  }

  const issues = take("issues", page.issues, (r) => r.updated_at);
  const nodes = take("canvas_nodes", page.nodes, (r) => r.updated_at);
  const edges = take("canvas_edges", page.edges, (r) => r.created_at);
  const tombs = take("tombstones", page.tombstones, (r) => r.deleted_at);

  const tombstones: SyncTombstoneRow[] = tombs
    .filter((t) => !page.alive.has(`${t.entity}:${t.entity_id}`))
    .map((t) => ({
      entity: t.entity as SyncTombstoneRow["entity"],
      entity_id: t.entity_id,
      issue_id: t.issue_id,
      deleted_at: t.deleted_at.toISOString(),
    }));

  return {
    cursor: nextCursor(plan, positions, hasMore),
    reset: plan.reset,
    has_more: hasMore,
    issues: issues.map(toIssueRow),
    canvas_nodes: nodes.map(toNodeRow),
    canvas_edges: edges.map(toEdgeRow),
    tombstones,
  };
}

/** Which tombstoned rows exist again — deleted, then restored with the same id. */
async function stillExisting(
  tx: Db,
  tombstones: { entity: string; entity_id: string }[]
): Promise<Set<string>> {
  const ids = (entity: string) => tombstones.filter((t) => t.entity === entity).map((t) => t.entity_id);
  const [issues, nodes, edges] = await Promise.all([
    ids("issue").length ? tx.issue.findMany({ where: { id: { in: ids("issue") } }, select: { id: true } }) : [],
    ids("canvas_node").length
      ? tx.canvasNode.findMany({ where: { id: { in: ids("canvas_node") } }, select: { id: true } })
      : [],
    ids("canvas_edge").length
      ? tx.canvasEdge.findMany({ where: { id: { in: ids("canvas_edge") } }, select: { id: true } })
      : [],
  ]);
  return new Set([
    ...issues.map((r) => `issue:${r.id}`),
    ...nodes.map((r) => `canvas_node:${r.id}`),
    ...edges.map((r) => `canvas_edge:${r.id}`),
  ]);
}

// ─── Refs ────────────────────────────────────────────────────────────────────

/** Clients, people and invoices — labels and @/# mentions, offline. */
export async function loadRefs(): Promise<SyncRefs> {
  const [clients, people, invoices] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color_hex: true } }),
    prisma.person.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, role: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      orderBy: { due_date: "desc" },
      select: {
        id: true,
        invoice_number: true,
        status: true,
        amount_cents: true,
        fee_cents: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  return {
    clients,
    people: people.map((p) => ({ id: p.id, name: p.name, role: p.role?.name ?? null, status: p.status })),
    invoices: invoices.map((i) => ({
      id: i.id,
      invoice_number: i.invoice_number,
      client_name: i.client.name,
      status: i.status,
      amount_cents: i.amount_cents,
      net_cents: i.amount_cents - i.fee_cents,
    })),
  };
}

// ─── Push ────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function prismaCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : null;
}

/** Which unique index a P2002 hit, as Prisma reports it. */
function hitSyncMutationKey(err: unknown): boolean {
  const meta = (err as { meta?: { target?: unknown; modelName?: unknown } } | null)?.meta;
  const target = meta?.target;
  return (
    meta?.modelName === "SyncMutation" ||
    (Array.isArray(target) && target.includes("mutation_id")) ||
    (typeof target === "string" && target.includes("mutation_id"))
  );
}

/**
 * What is kept of an answer: the verdict, never the row. A row can hold a long
 * note, and answers are kept for a month — storing rows would keep deleted
 * notes' text around and multiply one note by every change sent about it. A
 * replay reads the row again instead: the server's current one, which is also
 * the one the phone should have.
 */
type Verdict = Pick<SyncResult, "status" | "reason" | "conflict_copy_id">;

function verdictOf(result: SyncResult): Verdict {
  return {
    status: result.status,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
    ...(result.conflict_copy_id !== undefined ? { conflict_copy_id: result.conflict_copy_id } : {}),
  };
}

async function storedVerdict(mutationId: string): Promise<Verdict | null> {
  const row = await prisma.syncMutation.findUnique({ where: { mutation_id: mutationId } });
  const verdict = row?.result as Verdict | undefined;
  return verdict?.status ? verdict : null;
}

/** A stored answer, as sent the first time: the verdict, and the row as it is now. */
async function replay(item: { mutation_id: string }, verdict: Verdict): Promise<SyncResult> {
  // Only the verdict's fields: an answer stored before verdicts were trimmed
  // may still hold a row, and it would be stale.
  const result: SyncResult = { mutation_id: item.mutation_id, ...verdictOf(verdict as SyncResult) };
  if (verdict.status === "deleted") return result;
  const parsed = SyncMutationSchema.safeParse(item);
  if (!parsed.success) return result;
  return { ...result, row: await currentRow(parsed.data as SyncMutation) };
}

/**
 * Records an answer outside of the change's own transaction — for a change
 * the database refused, whose transaction is already rolled back. A retry
 * racing it finds the first answer.
 */
async function recordResult(item: { mutation_id: string }, result: SyncResult): Promise<SyncResult> {
  try {
    await prisma.syncMutation.create({
      data: { mutation_id: result.mutation_id, result: verdictOf(result) as object },
    });
    return result;
  } catch (err) {
    if (prismaCode(err) === "P2002") {
      const first = await storedVerdict(result.mutation_id);
      if (first) return replay(item, first);
    }
    throw err;
  }
}

/** The size of an answer as it goes out, in bytes of JSON. */
function answerBytes(result: SyncResult): number {
  return Buffer.byteLength(JSON.stringify(result), "utf8");
}

/**
 * Applies a push, in order, each change in its own transaction together with
 * the record of its answer.
 *
 * Stops early, answering what it has done (`more`), once the answers pass a
 * few megabytes or the push has run for ~10 s (SYNC_PUSH_BUDGET): the phone
 * sends the rest right away. Also stops at the first failure that is not the
 * change's own (the database unreachable); then the phone retries later.
 * Either way the changes without an answer are sent again, in order.
 */
export async function pushNotes(
  raw: { mutation_id: string }[],
  actor: string | null,
  now: () => number = Date.now
): Promise<{ results: SyncResult[]; more: boolean }> {
  const results: SyncResult[] = [];
  const started = now();
  let bytes = 0;
  for (const [i, item] of raw.entries()) {
    try {
      const result = await pushOne(item, actor);
      results.push(result);
      bytes += answerBytes(result);
    } catch (err) {
      console.error("[sync] push stopped at", item.mutation_id, err);
      return { results, more: false };
    }
    const last = i === raw.length - 1;
    if (!last && (bytes >= SYNC_PUSH_BUDGET.bytes || now() - started >= SYNC_PUSH_BUDGET.ms)) {
      return { results, more: true };
    }
  }
  return { results, more: false };
}

async function pushOne(item: { mutation_id: string }, actor: string | null): Promise<SyncResult> {
  const stored = await storedVerdict(item.mutation_id);
  if (stored) return replay(item, stored);

  const parsed = SyncMutationSchema.safeParse(item);
  if (!parsed.success) {
    return recordResult(item, { mutation_id: item.mutation_id, status: "rejected", reason: "invalid" });
  }
  const m = parsed.data as SyncMutation;

  try {
    return await inTransaction(actor, async (tx, ctx) => {
      // Claimed first: a concurrent retry of the same change waits on this
      // key and then finds the answer, instead of applying it a second time.
      await tx.syncMutation.create({ data: { mutation_id: m.mutation_id, result: {} } });
      const result = await apply(tx, m, ctx);
      await tx.syncMutation.update({
        where: { mutation_id: m.mutation_id },
        data: { result: verdictOf(result) as object },
      });
      return result;
    });
  } catch (err) {
    const code = prismaCode(err);
    if (code === "P2002" && hitSyncMutationKey(err)) {
      const first = await storedVerdict(m.mutation_id);
      if (first) return replay(item, first);
    }
    // What the database itself refused (a taken id, a missing reference, a
    // row gone mid-change) is this change's answer, not a server failure.
    if (code === "P2002" || code === "P2003" || code === "P2025") {
      const reason = code === "P2002" ? "duplicate" : code === "P2003" ? "reference_missing" : "not_found";
      return recordResult(item, { mutation_id: m.mutation_id, status: "rejected", reason, row: await currentRow(m) });
    }
    throw err;
  }
}

/** The row as the server has it now, for the phone to put back in place of its version. */
async function currentRow(m: SyncMutation, db: Db = prisma): Promise<SyncResult["row"]> {
  if (m.entity === "issue") {
    const r = await db.issue.findUnique({ where: { id: m.id }, select: ISSUE_SELECT });
    return r ? toIssueRow(r) : null;
  }
  if (m.entity === "canvas_node") {
    const r = await db.canvasNode.findUnique({ where: { id: m.id }, select: NODE_SELECT });
    return r ? toNodeRow(r) : null;
  }
  const r = await db.canvasEdge.findUnique({ where: { id: m.id }, select: EDGE_SELECT });
  return r ? toEdgeRow(r) : null;
}

function apply(tx: Db, m: SyncMutation, ctx: WriteContext): Promise<SyncResult> {
  if (m.entity === "issue") return m.op === "delete" ? deleteIssueChange(tx, m, ctx) : upsertIssue(tx, m, ctx);
  if (m.entity === "canvas_node") return m.op === "delete" ? deleteNodeChange(tx, m, ctx) : upsertNode(tx, m, ctx);
  return m.op === "delete" ? deleteEdgeChange(tx, m) : upsertEdge(tx, m);
}

const answer = (m: SyncMutation, rest: Omit<SyncResult, "mutation_id">): SyncResult => ({
  mutation_id: m.mutation_id,
  ...rest,
});

async function upsertIssue(tx: Db, m: SyncMutation, ctx: WriteContext): Promise<SyncResult> {
  const parsed = SyncIssueFieldsSchema.safeParse(m.fields ?? {});
  if (!parsed.success) return answer(m, { status: "rejected", reason: "invalid", row: await currentRow(m, tx) });
  const patch = pickSent(m.fields, parsed.data) as IssuePatch;

  const current = await tx.issue.findUnique({ where: { id: m.id } });

  // A client deleted on the web while the phone was offline: keep the note,
  // lose only the link — never the words.
  let reason: string | undefined;
  if (patch.client_id) {
    const client = await tx.client.findUnique({ where: { id: patch.client_id }, select: { id: true } });
    if (!client) {
      if (current) delete patch.client_id;
      else patch.client_id = null;
      reason = "client_missing";
    }
  }

  const plan = planIssueUpsert(current, { base_updated_at: m.base_updated_at, base_hash: m.base_hash, fields: patch });

  switch (plan.action) {
    case "reject":
      return answer(m, { status: "rejected", reason: plan.reason, row: current ? toIssueRow(current) : null });

    case "gone":
      return answer(m, { status: "deleted" });

    case "recover": {
      const copy = await createIssue(
        tx,
        {
          title: conflictTitle(m.title_hint ?? patch.title),
          category: "note",
          client_id: patch.client_id ?? null,
          description: plan.text,
        },
        ctx
      );
      if (!copy.ok) throw new Error(copy.error);
      return answer(m, { status: "conflict_copy", reason: "deleted_on_server", row: null, conflict_copy_id: copy.value.id });
    }

    case "create": {
      if (!UUID.test(m.id)) return answer(m, { status: "rejected", reason: "invalid", row: null });
      const created = await createIssue(tx, { ...plan.data, id: m.id, title: plan.data.title! }, ctx);
      if (!created.ok) return answer(m, { status: "rejected", reason: "shape", row: null });
      return answer(m, { status: "applied", ...(reason ? { reason } : {}), row: toIssueRow(created.value) });
    }

    case "update": {
      let row = current!;
      if (Object.keys(plan.data).length > 0) {
        const updated = await updateIssue(tx, m.id, plan.data, ctx);
        if (!updated.ok) return answer(m, { status: "rejected", reason: "shape", row: toIssueRow(current!) });
        row = updated.value;
      }
      if (plan.conflictText === undefined) {
        return answer(m, { status: "applied", ...(reason ? { reason } : {}), row: toIssueRow(row) });
      }
      const copy = await createIssue(
        tx,
        {
          title: conflictTitle(row.title),
          category: row.category,
          client_id: row.client_id,
          description: plan.conflictText,
        },
        ctx
      );
      if (!copy.ok) throw new Error(copy.error);
      return answer(m, { status: "conflict_copy", reason: "text_changed_on_server", row: toIssueRow(row), conflict_copy_id: copy.value.id });
    }
  }
}

async function deleteIssueChange(tx: Db, m: SyncMutation, ctx: WriteContext): Promise<SyncResult> {
  const current = await tx.issue.findUnique({ where: { id: m.id } });
  const plan = planDelete(current ? current.description : null, m.base_hash);
  if (plan.action === "noop") return answer(m, { status: "applied", reason: "already_deleted", row: null });
  if (plan.action === "reject") return answer(m, { status: "rejected", reason: plan.reason, row: toIssueRow(current!) });
  await deleteIssue(tx, m.id, ctx);
  return answer(m, { status: "applied", row: null });
}

async function upsertNode(tx: Db, m: SyncMutation, ctx: WriteContext): Promise<SyncResult> {
  const parsed = SyncNodeFieldsSchema.safeParse(m.fields ?? {});
  if (!parsed.success) return answer(m, { status: "rejected", reason: "invalid", row: await currentRow(m, tx) });
  const patch = pickSent(m.fields, parsed.data) as NodePatch;

  const current = await tx.canvasNode.findUnique({ where: { id: m.id }, select: NODE_SELECT });
  const issueId = current?.issue_id ?? patch.issue_id;
  const canvas = issueId ? await canvasOf(tx, issueId) : null;

  const plan = planNodeUpsert(current, { base_updated_at: m.base_updated_at, base_hash: m.base_hash, fields: patch }, canvas);

  switch (plan.action) {
    case "reject":
      return answer(m, { status: "rejected", reason: plan.reason, row: current ? toNodeRow(current) : null });

    case "gone":
      return answer(m, { status: "deleted" });

    case "recover": {
      const copy = await createIssue(
        tx,
        {
          title: conflictTitle(canvas ? `${canvas.title} · idea` : null, "Recovered idea"),
          category: "note",
          description: plan.text,
        },
        ctx
      );
      if (!copy.ok) throw new Error(copy.error);
      return answer(m, { status: "conflict_copy", reason: "deleted_on_server", row: null, conflict_copy_id: copy.value.id });
    }

    case "create": {
      if (!UUID.test(m.id)) return answer(m, { status: "rejected", reason: "invalid", row: null });
      await createNode(tx, { ...plan.data, id: m.id });
      return answer(m, { status: "applied", row: await currentRow(m, tx) });
    }

    case "update": {
      if (Object.keys(plan.data).length > 0) await updateNode(tx, current!.issue_id, m.id, plan.data);
      const row = await currentRow(m, tx);
      if (!plan.conflictCopy) return answer(m, { status: "applied", row });
      const copy = await createNode(tx, plan.conflictCopy);
      return answer(m, { status: "conflict_copy", reason: "text_changed_on_server", row, conflict_copy_id: copy.id });
    }
  }
}

async function deleteNodeChange(tx: Db, m: SyncMutation, ctx: WriteContext): Promise<SyncResult> {
  const current = await tx.canvasNode.findUnique({ where: { id: m.id }, select: NODE_SELECT });
  const plan = planDelete(current ? current.content : null, m.base_hash);
  if (plan.action === "noop") return answer(m, { status: "applied", reason: "already_deleted", row: null });
  if (plan.action === "reject") return answer(m, { status: "rejected", reason: plan.reason, row: toNodeRow(current!) });
  await deleteNode(tx, current!.issue_id, m.id, ctx);
  return answer(m, { status: "applied", row: null });
}

async function upsertEdge(tx: Db, m: SyncMutation): Promise<SyncResult> {
  // A connection is never edited: if it exists, there is nothing to do.
  const current = await tx.canvasEdge.findUnique({ where: { id: m.id }, select: EDGE_SELECT });
  if (current) return answer(m, { status: "applied", row: toEdgeRow(current) });

  const parsed = SyncEdgeFieldsSchema.safeParse(m.fields ?? {});
  if (!parsed.success || !UUID.test(m.id)) return answer(m, { status: "rejected", reason: "invalid", row: null });
  const { issue_id, source_id, target_id } = parsed.data;

  const canvas = await canvasOf(tx, issue_id);
  if (!canvas) return answer(m, { status: "deleted", reason: "deleted_on_server" });
  if (!canvas.isCanvas) return answer(m, { status: "rejected", reason: "not_a_canvas", row: null });

  // The same connection under another id: the phone should adopt that one.
  const same = await tx.canvasEdge.findFirst({ where: { issue_id, source_id, target_id }, select: EDGE_SELECT });
  if (same) return answer(m, { status: "rejected", reason: "duplicate", row: toEdgeRow(same) });

  // An end deleted on the server: the connection went with it.
  const ends = await tx.canvasNode.count({ where: { issue_id, id: { in: [source_id, target_id] } } });
  if (ends < 2) return answer(m, { status: "deleted", reason: "endpoint_missing" });

  await createEdge(tx, { id: m.id, issue_id, source_id, target_id });
  return answer(m, { status: "applied", row: await currentRow(m, tx) });
}

async function deleteEdgeChange(tx: Db, m: SyncMutation): Promise<SyncResult> {
  const current = await tx.canvasEdge.findUnique({ where: { id: m.id }, select: EDGE_SELECT });
  if (!current) return answer(m, { status: "applied", reason: "already_deleted", row: null });
  await deleteEdge(tx, current.issue_id, m.id);
  return answer(m, { status: "applied", row: null });
}
