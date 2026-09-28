import { useEffect, useRef, useState } from "react";
import * as SQLite from "expo-sqlite";

/**
 * The phone's own copy of the notes: one SQLite file, the only thing the
 * screens ever read. The server is reached only by the sync engine
 * (src/sync/engine.ts), which writes what it learns here.
 *
 * Why raw SQL and not an ORM (drizzle): five tables, a handful of queries,
 * migrations that are a list of SQL strings keyed by `PRAGMA user_version` —
 * no code generation, no bundler plugin to load migration files, no extra
 * dependency, and every transaction boundary visible where it matters.
 */

const DB_NAME = "book.db";

/**
 * Append-only: each entry upgrades the file from the version before it. Never
 * edit one that has shipped — add the next.
 */
const MIGRATIONS: string[] = [
  // 1 — phase 2: notes, their canvas, what labels them, and the queue.
  `
  CREATE TABLE issues (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    client_id TEXT,
    category TEXT NOT NULL,
    note_format TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL,
    due_date TEXT,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    server_updated_at TEXT,
    announced INTEGER NOT NULL DEFAULT 1,
    deleted_at INTEGER,
    sync_error TEXT,
    search TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX issues_updated_at ON issues (updated_at);

  CREATE TABLE canvas_nodes (
    id TEXT PRIMARY KEY NOT NULL,
    issue_id TEXT NOT NULL,
    content TEXT NOT NULL,
    color TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    search TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX canvas_nodes_issue ON canvas_nodes (issue_id);

  CREATE TABLE canvas_edges (
    id TEXT PRIMARY KEY NOT NULL,
    issue_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX canvas_edges_issue ON canvas_edges (issue_id);

  CREATE TABLE clients (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color_hex TEXT NOT NULL);
  CREATE TABLE people (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, role TEXT, status TEXT NOT NULL);
  CREATE TABLE invoices (
    id TEXT PRIMARY KEY NOT NULL,
    invoice_number TEXT,
    client_name TEXT NOT NULL,
    status TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    net_cents INTEGER NOT NULL
  );

  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    mutation_id TEXT NOT NULL UNIQUE,
    entity TEXT NOT NULL,
    op TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    fields TEXT NOT NULL DEFAULT '{}',
    base_updated_at TEXT,
    base_hash TEXT,
    title_hint TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX outbox_row ON outbox (entity, entity_id);

  CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `,

  // 2 — invoices without net_cents: the phone never showed it, and a lost
  // phone would keep every invoice's net in plain text. Invoices are a cache
  // replaced whole on every refs fetch, so the table is rebuilt empty.
  `
  DROP TABLE invoices;
  CREATE TABLE invoices (
    id TEXT PRIMARY KEY NOT NULL,
    invoice_number TEXT,
    client_name TEXT NOT NULL,
    status TEXT NOT NULL,
    amount_cents INTEGER NOT NULL
  );
  DELETE FROM meta WHERE key = 'sync.refs_at';
  `,
];

let opening: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync("PRAGMA journal_mode = WAL;");
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
  return db;
}

/** The database, opened and migrated once per process. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  opening ??= open().catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export type Table = "issues" | "canvas_nodes" | "canvas_edges" | "refs" | "outbox" | "meta";

let queue: Promise<unknown> = Promise.resolve();

/**
 * Every write goes through here: one at a time, each in a transaction.
 *
 * Serialising them in JS is what makes a plain transaction on the shared
 * connection safe — expo-sqlite would otherwise let another async write slip
 * in between a transaction's statements. Readers are notified of the tables
 * that changed once the transaction has committed.
 */
export function write<T>(tables: Table[], fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await getDb();
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await fn(db);
    });
    notify(tables);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

// ─── Live reads ──────────────────────────────────────────────────────────────

const listeners = new Set<(tables: Set<Table>) => void>();

function notify(tables: Table[]) {
  const set = new Set(tables);
  for (const listener of listeners) listener(set);
}

export function onTablesChanged(listener: (tables: Set<Table>) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A query that re-runs whenever one of `tables` is written, or `deps` change.
 * `undefined` until the first result. Out-of-order results are dropped.
 */
export function useLiveQuery<T>(
  tables: Table[],
  query: (db: SQLite.SQLiteDatabase) => Promise<T>,
  deps: unknown[]
): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  // The latest query function, without making every render re-subscribe.
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });
  const tablesKey = tables.join(",");

  useEffect(() => {
    let active = true;
    let generation = 0;
    const run = () => {
      const mine = ++generation;
      getDb()
        .then((db) => queryRef.current(db))
        .then((result) => {
          if (active && mine === generation) setValue(result);
        })
        .catch((err) => console.warn("[db] query failed", err));
    };
    run();
    const watched = tablesKey.split(",") as Table[];
    const off = onTablesChanged((changed) => {
      if (watched.some((t) => changed.has(t))) run();
    });
    return () => {
      active = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, ...deps]);

  return value;
}

/**
 * Forgets everything on this phone: signing out on purpose means the notes
 * should not stay behind. (A token that merely expired keeps them, so
 * unsent changes still reach the server after signing back in.)
 */
export async function wipeLocalData(): Promise<void> {
  await write(["issues", "canvas_nodes", "canvas_edges", "refs", "outbox", "meta"], async (db) => {
    await db.execAsync(
      "DELETE FROM issues; DELETE FROM canvas_nodes; DELETE FROM canvas_edges; DELETE FROM clients; DELETE FROM people; DELETE FROM invoices; DELETE FROM outbox; DELETE FROM meta;"
    );
  });
}
