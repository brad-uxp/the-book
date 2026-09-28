import { AppState, type AppStateStatus } from "react-native";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import {
  SYNC_PUSH_MAX,
  type SyncEdgeRow,
  type SyncNodeRow,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncRefs,
  type SyncResult,
} from "@shared/sync-protocol";
import { getDb, write } from "@/db/database";
import * as repo from "@/db/repo";
import { ApiError, apiRequest } from "@/lib/api";
import { dropBlankDrafts, finalizeDeletes } from "@/notes/store";
import { TEXT_TOO_LONG, mergeIssue, refusedTextCopy, resultEffect } from "./merge";
import { newId } from "@/lib/hash";
import { backoffMs, type PendingMutation } from "./outbox";

/**
 * Keeps the phone's SQLite and the server in step.
 *
 * One run = push the queue (oldest first), then pull what changed since the
 * cursor. Runs on start, when the app comes to the foreground, when the
 * network comes back, on pull-to-refresh, and two seconds after the person
 * stops changing things. A failed run is retried with growing waits; a 401
 * means the token is gone, and hands over to the sign-out flow.
 */

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  /** When the last run finished cleanly (ms). */
  lastSyncedAt: number | null;
  /** The last run's failure, readable; null after a clean run. */
  error: string | null;
  /** How many of the phone's changes the server kept as conflict copies since the app started. */
  conflictCopies: number;
}

const CURSOR = "sync.cursor";
const LAST_SYNCED = "sync.last_synced_at";
const REFS_AT = "sync.refs_at";

/** Refs change rarely; refreshed with any foreground/manual run, or when this old. */
const REFS_MAX_AGE_MS = 10 * 60_000;

/**
 * A push body stays well under the server's 5 MB cap. Characters, not bytes:
 * UTF-16 length undercounts a multi-byte character by at most 3×, hence the
 * margin.
 */
const PUSH_BUDGET_CHARS = 1_500_000;

const ALL_TABLES = ["issues", "canvas_nodes", "canvas_edges", "outbox", "meta"] as const;

function wire(m: PendingMutation) {
  return {
    mutation_id: m.mutation_id,
    entity: m.entity,
    op: m.op,
    id: m.entity_id,
    ...(m.base_updated_at ? { base_updated_at: m.base_updated_at } : {}),
    ...(m.base_hash ? { base_hash: m.base_hash } : {}),
    ...(m.title_hint ? { title_hint: m.title_hint } : {}),
    ...(m.op === "upsert" ? { fields: m.fields } : {}),
  };
}

export class SyncEngine {
  private status: SyncStatus = { online: true, syncing: false, lastSyncedAt: null, error: null, conflictCopies: 0 };
  private listeners = new Set<(s: SyncStatus) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private running: Promise<void> | null = null;
  private again: { refs: boolean } | null = null;
  private failures = 0;
  private stopped = false;
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly token: string,
    private readonly onUnauthorized: () => void
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    getDb()
      .then((db) => repo.getMeta(db, LAST_SYNCED))
      .then((v) => this.set({ lastSyncedAt: v ? Number(v) : null }))
      .catch(() => undefined);

    const offNet = NetInfo.addEventListener((state: NetInfoState) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      const cameBack = online && !this.status.online;
      this.set({ online });
      if (cameBack) void this.syncNow({ refs: true });
    });
    const appState = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") void this.syncNow({ refs: true });
    });
    this.unsubscribers.push(offNet, () => appState.remove());

    void dropBlankDrafts()
      .then(() => finalizeDeletes())
      .catch(() => undefined)
      .finally(() => this.syncNow({ refs: true }));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.listeners.clear();
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  // ─── Scheduling ────────────────────────────────────────────────────────────

  /** A run in `delayMs`, unless one is already due sooner. */
  schedule(delayMs: number): void {
    if (this.stopped) return;
    const at = Date.now() + delayMs;
    if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delayMs);
  }

  /** A run now; if one is going, another right after it. Resolves when the phone is in step (or gave up for now). */
  async syncNow(opts: { refs?: boolean } = {}): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.again = { refs: (this.again?.refs ?? false) || !!opts.refs };
      return this.running;
    }
    this.running = this.run(!!opts.refs).finally(() => {
      this.running = null;
      const next = this.again;
      this.again = null;
      if (next && !this.stopped) void this.syncNow(next);
    });
    return this.running;
  }

  private async run(refs: boolean): Promise<void> {
    if (!this.status.online) return;
    this.set({ syncing: true });
    try {
      await this.push();
      await this.pull();
      const db = await getDb();
      const refsAt = Number((await repo.getMeta(db, REFS_AT)) ?? 0);
      if (refs || Date.now() - refsAt > REFS_MAX_AGE_MS) await this.pullRefs();
      const now = Date.now();
      await write(["meta"], (d) => repo.setMeta(d, LAST_SYNCED, String(now)));
      this.failures = 0;
      this.set({ syncing: false, lastSyncedAt: now, error: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.set({ syncing: false });
        this.stop();
        this.onUnauthorized();
        return;
      }
      this.failures += 1;
      this.set({ syncing: false, error: err instanceof Error ? err.message : "Sync failed" });
      this.schedule(backoffMs(this.failures) * (0.75 + Math.random() / 2));
    }
  }

  // ─── Push ──────────────────────────────────────────────────────────────────

  private async push(): Promise<void> {
    for (;;) {
      // Read and mark as sent in one step: an edit landing in between must
      // not fold into a change that is already on its way.
      const batch = await write(["outbox"], async (db) => {
        const candidates = await repo.nextBatch(db, SYNC_PUSH_MAX);
        const out: PendingMutation[] = [];
        let size = 0;
        for (const m of candidates) {
          size += JSON.stringify(m.fields).length;
          if (out.length > 0 && size > PUSH_BUDGET_CHARS) break;
          out.push(m);
        }
        await repo.markSent(db, out.map((m) => m.seq));
        return out;
      });
      if (batch.length === 0) return;

      const res = await apiRequest<SyncPushResponse>("/api/sync/notes", {
        token: this.token,
        method: "POST",
        body: { mutations: batch.map(wire) },
      });
      await this.applyResults(batch, res.results);
      if (res.results.length < batch.length) {
        // `more`: the server answered part of it on purpose (its answer grew
        // too big, or the push too long). The rest is still queued: send it now.
        if (res.more) continue;
        throw new Error("The server stopped partway. Retrying soon.");
      }
    }
  }

  private async applyResults(batch: PendingMutation[], results: SyncResult[]): Promise<void> {
    let copies = 0;
    await write([...ALL_TABLES], async (db) => {
      for (const result of results) {
        const m = batch.find((b) => b.mutation_id === result.mutation_id);
        if (!m) continue;
        await repo.dropPending(db, m.mutation_id);
        if (result.status === "conflict_copy") copies += 1;
        const queue = await repo.queueFor(db, m.entity, m.entity_id);

        if (m.entity === "issue") {
          // Words the server refused are kept aside before its row replaces them.
          const copy = refusedTextCopy(result, m, await repo.getIssue(db, m.entity_id), newId(), new Date().toISOString());
          if (copy) await repo.putIssue(db, copy);
          const effect = resultEffect(result, m.op, queue);
          if (effect.kind === "row") {
            const merged = mergeIssue(await repo.getIssue(db, m.entity_id), effect.row, queue);
            if (merged !== "skip") {
              await repo.putIssue(db, effect.restore ? { ...merged, deleted_at: null } : merged);
            }
          } else if (effect.kind === "drop") {
            await repo.removeIssue(db, m.entity_id);
          } else if (effect.kind === "flag") {
            await db.runAsync("UPDATE issues SET sync_error = ? WHERE id = ?", effect.reason, m.entity_id);
          }
        } else if (queue.length === 0) {
          // Ideas and connections: the canvas arrives on the phone in phase 3,
          // which is what writes them; answers are applied as they come.
          const row = result.row;
          if (row && m.entity === "canvas_node") await repo.putNode(db, row as SyncNodeRow);
          else if (row && m.entity === "canvas_edge") await repo.putEdge(db, row as SyncEdgeRow);
          else if (result.status === "deleted" || m.op === "delete") {
            await repo.removeTombstoned(db, { entity: m.entity, entity_id: m.entity_id, issue_id: null, deleted_at: "" });
          }
        }
      }
    });
    if (copies) this.set({ conflictCopies: this.status.conflictCopies + copies });
  }

  // ─── Pull ──────────────────────────────────────────────────────────────────

  private async pull(): Promise<void> {
    const db = await getDb();
    const startCursor = await repo.getMeta(db, CURSOR);
    let cursor = startCursor;
    let first = true;
    for (;;) {
      const page = await apiRequest<SyncPullResponse>(
        `/api/sync/notes${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`,
        { token: this.token }
      );
      const fullSync = first && (!startCursor || page.reset);
      await write([...ALL_TABLES], async (d) => {
        if (fullSync) await this.forgetSyncedRows(d);
        for (const row of page.issues) {
          const queue = await repo.queueFor(d, "issue", row.id);
          const merged = mergeIssue(await repo.getIssue(d, row.id), row, queue);
          if (merged !== "skip") await repo.putIssue(d, merged);
        }
        for (const node of page.canvas_nodes) {
          if ((await repo.queueFor(d, "canvas_node", node.id)).length === 0) await repo.putNode(d, node);
        }
        for (const edge of page.canvas_edges) await repo.putEdge(d, edge);
        // Deletions last: a row and its own deletion never share a page (the
        // server reads one snapshot), but a note's ideas may.
        for (const t of page.tombstones) {
          if ((await repo.queueFor(d, t.entity, t.entity_id)).length === 0) await repo.removeTombstoned(d, t);
        }
        await repo.setMeta(d, CURSOR, page.cursor);
      });
      cursor = page.cursor;
      first = false;
      if (!page.has_more) return;
    }
  }

  /**
   * A full sync starts from what the server has: every row the phone got from
   * it goes, except those with changes still queued (they are the person's
   * words), notes whose text is held back as too long (the same), and new
   * notes the server has never seen.
   */
  private async forgetSyncedRows(d: Awaited<ReturnType<typeof getDb>>): Promise<void> {
    await d.runAsync(
      `DELETE FROM issues
       WHERE server_updated_at IS NOT NULL AND deleted_at IS NULL
         AND (sync_error IS NULL OR sync_error <> ?)
         AND id NOT IN (SELECT entity_id FROM outbox WHERE entity = 'issue')`,
      TEXT_TOO_LONG
    );
    await d.runAsync("DELETE FROM canvas_nodes WHERE id NOT IN (SELECT entity_id FROM outbox WHERE entity = 'canvas_node')");
    await d.runAsync("DELETE FROM canvas_edges WHERE id NOT IN (SELECT entity_id FROM outbox WHERE entity = 'canvas_edge')");
  }

  private async pullRefs(): Promise<void> {
    const refs = await apiRequest<SyncRefs>("/api/sync/refs", { token: this.token });
    await write(["refs", "meta"], async (d) => {
      await repo.replaceRefs(d, refs);
      await repo.setMeta(d, REFS_AT, String(Date.now()));
    });
  }
}
