import type { SQLiteDatabase } from "expo-sqlite";
import type {
  SyncEdgeRow,
  SyncEntity,
  SyncNodeRow,
  SyncRefs,
  SyncTombstoneRow,
} from "@shared/sync-protocol";
import type { LocalIssue } from "@/sync/merge";
import type { PendingMutation } from "@/sync/outbox";
import { searchText } from "@/notes/text";

/**
 * The SQL behind the local store. Plain functions over a database handle —
 * callers decide the transaction (src/db/database.ts `write`).
 */

// ─── Issues ──────────────────────────────────────────────────────────────────

type IssueRecord = Omit<LocalIssue, "announced"> & { announced: number };

function toIssue(r: IssueRecord): LocalIssue {
  return { ...r, announced: r.announced ? 1 : 0 };
}

export async function getIssue(db: SQLiteDatabase, id: string): Promise<LocalIssue | null> {
  const r = await db.getFirstAsync<IssueRecord>("SELECT * FROM issues WHERE id = ?", id);
  return r ? toIssue(r) : null;
}

const ISSUE_COLUMNS = [
  "id",
  "title",
  "client_id",
  "category",
  "note_format",
  "status",
  "progress",
  "due_date",
  "description",
  "sort_order",
  "created_at",
  "updated_at",
  "server_updated_at",
  "announced",
  "deleted_at",
  "sync_error",
  "search",
] as const;

export async function putIssue(db: SQLiteDatabase, issue: LocalIssue): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO issues (${ISSUE_COLUMNS.join(", ")}) VALUES (${ISSUE_COLUMNS.map(() => "?").join(", ")})`,
    ISSUE_COLUMNS.map((c) => issue[c] ?? null)
  );
}

/** An issue and everything drawn on it. */
export async function removeIssue(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync("DELETE FROM canvas_edges WHERE issue_id = ?", id);
  await db.runAsync("DELETE FROM canvas_nodes WHERE issue_id = ?", id);
  await db.runAsync("DELETE FROM issues WHERE id = ?", id);
}

// ─── Canvas ──────────────────────────────────────────────────────────────────

export async function putNode(db: SQLiteDatabase, n: SyncNodeRow): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO canvas_nodes (id, issue_id, content, color, x, y, width, height, created_at, updated_at, search)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [n.id, n.issue_id, n.content, n.color, n.x, n.y, n.width, n.height, n.created_at, n.updated_at, searchText("", n.content)]
  );
}

export async function removeNode(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync("DELETE FROM canvas_edges WHERE source_id = ? OR target_id = ?", id, id);
  await db.runAsync("DELETE FROM canvas_nodes WHERE id = ?", id);
}

export async function putEdge(db: SQLiteDatabase, e: SyncEdgeRow): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO canvas_edges (id, issue_id, source_id, target_id, created_at) VALUES (?, ?, ?, ?, ?)",
    [e.id, e.issue_id, e.source_id, e.target_id, e.created_at]
  );
}

export async function removeTombstoned(db: SQLiteDatabase, t: SyncTombstoneRow): Promise<void> {
  if (t.entity === "issue") await removeIssue(db, t.entity_id);
  else if (t.entity === "canvas_node") await removeNode(db, t.entity_id);
  else await db.runAsync("DELETE FROM canvas_edges WHERE id = ?", t.entity_id);
}

// ─── Refs ────────────────────────────────────────────────────────────────────

/** Replaced whole: a few hundred rows, and anything deleted on the web disappears with it. */
export async function replaceRefs(db: SQLiteDatabase, refs: SyncRefs): Promise<void> {
  await db.execAsync("DELETE FROM clients; DELETE FROM people; DELETE FROM invoices;");
  for (const c of refs.clients) {
    await db.runAsync("INSERT INTO clients (id, name, color_hex) VALUES (?, ?, ?)", [c.id, c.name, c.color_hex]);
  }
  for (const p of refs.people) {
    await db.runAsync("INSERT INTO people (id, name, role, status) VALUES (?, ?, ?, ?)", [p.id, p.name, p.role, p.status]);
  }
  for (const i of refs.invoices) {
    await db.runAsync(
      "INSERT INTO invoices (id, invoice_number, client_name, status, amount_cents) VALUES (?, ?, ?, ?, ?)",
      [i.id, i.invoice_number, i.client_name, i.status, i.amount_cents]
    );
  }
}

// ─── Outbox ──────────────────────────────────────────────────────────────────

type OutboxRecord = Omit<PendingMutation, "fields"> & { fields: string };

function toPending(r: OutboxRecord): PendingMutation {
  return { ...r, fields: JSON.parse(r.fields) as Record<string, unknown> };
}

/** What is still queued for one row, oldest first. */
export async function queueFor(db: SQLiteDatabase, entity: SyncEntity, id: string): Promise<PendingMutation[]> {
  const rows = await db.getAllAsync<OutboxRecord>(
    "SELECT * FROM outbox WHERE entity = ? AND entity_id = ? ORDER BY seq",
    entity,
    id
  );
  return rows.map(toPending);
}

export async function nextBatch(db: SQLiteDatabase, limit: number): Promise<PendingMutation[]> {
  const rows = await db.getAllAsync<OutboxRecord>("SELECT * FROM outbox ORDER BY seq LIMIT ?", limit);
  return rows.map(toPending);
}

export async function enqueue(
  db: SQLiteDatabase,
  m: Omit<PendingMutation, "seq" | "attempts">
): Promise<void> {
  await db.runAsync(
    `INSERT INTO outbox (mutation_id, entity, op, entity_id, fields, base_updated_at, base_hash, title_hint, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [m.mutation_id, m.entity, m.op, m.entity_id, JSON.stringify(m.fields), m.base_updated_at, m.base_hash, m.title_hint, Date.now()]
  );
}

export async function rewritePending(
  db: SQLiteDatabase,
  seq: number,
  m: { fields: Record<string, unknown>; base_hash: string | null; title_hint: string | null }
): Promise<void> {
  await db.runAsync("UPDATE outbox SET fields = ?, base_hash = ?, title_hint = ? WHERE seq = ? AND attempts = 0", [
    JSON.stringify(m.fields),
    m.base_hash,
    m.title_hint,
    seq,
  ]);
}

export async function dropPending(db: SQLiteDatabase, mutationId: string): Promise<void> {
  await db.runAsync("DELETE FROM outbox WHERE mutation_id = ?", mutationId);
}

/** Marks a batch as sent. From here on none of them absorbs another edit. */
export async function markSent(db: SQLiteDatabase, seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  await db.runAsync(`UPDATE outbox SET attempts = attempts + 1 WHERE seq IN (${seqs.map(() => "?").join(",")})`, seqs);
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
  return r?.value ?? null;
}

export async function setMeta(db: SQLiteDatabase, key: string, value: string | null): Promise<void> {
  if (value === null) await db.runAsync("DELETE FROM meta WHERE key = ?", key);
  else await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
}
