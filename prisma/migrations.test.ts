import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { READONLY_TOKEN_PREFIX } from "@/lib/readonly-token";

/**
 * Several database objects cannot be expressed in schema.prisma:
 *
 *  - a PARTIAL unique (uniqueness only among non-soft-deleted payments)
 *  - a FUNCTIONAL unique (case-insensitive invoice numbers)
 *  - CHECK constraints (the settings singleton, the no-self-link on
 *    CanvasEdge, canvas-only-for-notes on Task)
 *
 * Prisma treats anything it cannot see as drift, so `prisma migrate dev` will
 * happily generate a migration that DROPs them. And `pnpm start` runs
 * `prisma migrate deploy` on every boot, so such a migration reaches
 * production the moment it is committed — no human step in between.
 *
 * Losing the first one means the daily cron and the manual payment route,
 * which both check-then-insert, can double-charge a period. Losing the second
 * lets two concurrent creates write the same invoice number.
 *
 * These tests are the mechanical guard: the build fails before that migration
 * can be committed.
 */

const MIGRATIONS_DIR = join(__dirname, "migrations");

const PROTECTED_INDEXES = [
  {
    name: "SubscriptionPayment_subscription_id_due_date_active_key",
    purpose: "stops a subscription period from being paid twice",
  },
  {
    name: "Invoice_invoice_number_lower_key",
    purpose: "stops duplicate invoice numbers (case-insensitive)",
  },
];

/**
 * Postgres never executes a comment, so neither does this guard read one.
 *
 * Without this, a migration that explains in its header *why* it does not drop
 * a protected index fails the very test it is documenting — and the way out of
 * a false positive is to delete the explanation, which is exactly the comment
 * the next person needs.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

function migrationSql(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => statSync(join(MIGRATIONS_DIR, d)).isDirectory())
    .sort()
    .map((dir) => {
      const file = join(dir, "migration.sql");
      const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      return { file, sql: stripSqlComments(raw) };
    });
}

describe("índices críticos que Prisma no puede modelar", () => {
  const migrations = migrationSql();

  it("hay migraciones que leer", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  // stripSqlComments hace que este guard ignore los comentarios. Si además
  // dejara de ver el SQL real, pasaría para siempre sin proteger nada.
  it("sigue detectando un DROP real, no solo ignorando comentarios", () => {
    const idx = PROTECTED_INDEXES[0].name;
    const real = stripSqlComments(
      `-- No dropeamos "${idx}" nunca.\nDROP INDEX "${idx}";\n`
    );
    expect(real).not.toMatch(/^--/m);
    expect(
      new RegExp(`DROP\\s+INDEX\\s+(IF\\s+EXISTS\\s+)?"?${idx}"?`, "i").test(real)
    ).toBe(true);
  });

  for (const idx of PROTECTED_INDEXES) {
    it(`${idx.name} se crea en alguna migración`, () => {
      const created = migrations.some((m) =>
        new RegExp(`CREATE\\s+UNIQUE\\s+INDEX\\s+"${idx.name}"`, "i").test(m.sql)
      );
      expect(created, `falta el CREATE — ${idx.purpose}`).toBe(true);
    });

    it(`ninguna migración dropea ${idx.name}`, () => {
      const dropped = migrations.filter((m) =>
        new RegExp(`DROP\\s+INDEX\\s+(IF\\s+EXISTS\\s+)?"?${idx.name}"?`, "i").test(
          m.sql
        )
      );
      expect(
        dropped.map((d) => d.file),
        `una migración dropea este índice — ${idx.purpose}. ` +
          `Si prisma migrate dev lo generó, borrá esa línea del SQL antes de commitear.`
      ).toEqual([]);
    });
  }
});

/**
 * Statements that destroy rows or columns outright.
 *
 * `pnpm start` runs `prisma migrate deploy` on boot, so a migration reaches
 * production the moment it is committed — there is no human between the commit
 * and the data. Anything on this list has to be a deliberate, reviewed choice,
 * not something `prisma migrate dev` generated from a renamed field while
 * nobody was reading the SQL.
 *
 * Dropping an index or a constraint is NOT here: the FK swap in
 * 20260725020000 does exactly that on purpose, and the protected objects above
 * already have their own guard.
 *
 * To land one on purpose, put the marker below in the migration, on its own
 * line, together with the reason and how the data is preserved.
 */
const DESTRUCTIVE = [
  { re: /\bDROP\s+TABLE\b/i, what: "DROP TABLE" },
  { re: /\bDROP\s+COLUMN\b/i, what: "DROP COLUMN" },
  { re: /\bTRUNCATE\b/i, what: "TRUNCATE" },
  { re: /\bDELETE\s+FROM\b/i, what: "DELETE FROM" },
  { re: /\bDROP\s+DATABASE\b/i, what: "DROP DATABASE" },
];

const DESTRUCTIVE_OPT_IN = "ACEPTO PERDER ESTOS DATOS";

describe("ninguna migración borra datos sin decirlo", () => {
  const migrations = migrationSql();
  const raw = new Map(
    readdirSync(MIGRATIONS_DIR)
      .filter((d) => statSync(join(MIGRATIONS_DIR, d)).isDirectory())
      .map((dir) => [
        join(dir, "migration.sql"),
        readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"),
      ])
  );

  it.each(migrations.map((m) => [m.file, m.sql] as const))(
    "%s no destruye filas ni columnas",
    (file, sql) => {
      const hits = DESTRUCTIVE.filter((d) => d.re.test(sql)).map((d) => d.what);
      // El opt-in va en el comentario, que sql ya no tiene.
      const acknowledged = (raw.get(file) ?? "").includes(DESTRUCTIVE_OPT_IN);

      expect(
        acknowledged ? [] : hits,
        `esta migración borra datos (${hits.join(", ")}) y \`pnpm start\` la ` +
          `aplica sola en producción. Si es intencional, escribí en un ` +
          `comentario del SQL "${DESTRUCTIVE_OPT_IN}" con el motivo y cómo se ` +
          `preserva lo que se va.`
      ).toEqual([]);
    }
  );
});

// IssueLink_no_self_link was here until 20260927190000, which drops the
// IssueLink table itself — deliberately, with the destructive opt-in.
//
// `table` and `columns`: what the constraint rests on. Dropping the table, or
// any of those columns, drops the constraint with it without naming it, so
// those count as dropping it too.
const PROTECTED_CONSTRAINTS = [
  {
    name: "settings_singleton_check",
    table: "Settings",
    columns: ["id"],
    purpose: "keeps Settings to a single row",
  },
  {
    name: "Task_canvas_only_for_notes",
    table: "Task",
    columns: ["category", "note_format"],
    purpose:
      "keeps canvases on notes — a canvas task would dodge every rule keyed on category = note",
  },
  {
    name: "CanvasEdge_no_self_link",
    table: "CanvasEdge",
    columns: ["source_id", "target_id"],
    purpose: "stops an idea from connecting to itself on a canvas note",
  },
  {
    name: "CanvasEdge_sides_valid",
    table: "CanvasEdge",
    columns: ["source_side", "target_side"],
    purpose: "keeps a connection's pinned sides to top, right, bottom or left",
  },
  {
    name: "ApiToken_oauth_audience_together",
    table: "ApiToken",
    columns: ["oauth_grant_id", "audience"],
    purpose: "an OAuth access token always has its audience, and only it has one: the REST API refuses audience-bound tokens",
  },
  {
    name: "ApiToken_readonly_prefix",
    table: "ApiToken",
    columns: ["kind", "token_prefix"],
    purpose:
      "every read-only token starts with tbro_: builds older than that head refuse it (401) instead of taking a tb_ one for the owner's after a rollback",
  },
];

/** A migration's statements, comments already gone. */
function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** An identifier as SQL may write it: quoted or not, maybe schema-qualified. */
const ident = (name: string) => `(?:"?public"?\\.)?"?${name}"?(?=[\\s,;()]|$)`;

/** Whether a statement drops `table` (DROP TABLE, alone or in a list). */
function dropsTable(stmt: string, table: string): boolean {
  const m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]+?)(?:\s+(?:CASCADE|RESTRICT))?$/i.exec(stmt);
  return !!m && m[1].split(",").some((t) => new RegExp(`^\\s*${ident(table)}\\s*$`).test(t));
}

type Check = { table: string; body: string };

/**
 * What one statement does to the CHECK constraints, by name: ADD CONSTRAINT …
 * CHECK (…) adds one, DROP CONSTRAINT drops it, RENAME CONSTRAINT moves it to
 * its new name, DROP TABLE takes its table's. Enough for what these
 * migrations do: one CHECK per ALTER TABLE.
 */
function applyToChecks(checks: Map<string, Check>, stmt: string): void {
  const dropped = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]+?)(?:\s+(?:CASCADE|RESTRICT))?$/i.exec(stmt);
  if (dropped) {
    for (const [name, c] of checks) if (dropsTable(stmt, c.table)) checks.delete(name);
    return;
  }
  const table = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?public"?\.)?"?(\w+)"?\s/i.exec(stmt)?.[1];
  if (!table) return;
  for (const d of stmt.matchAll(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) checks.delete(d[1]);
  const added = /ADD\s+CONSTRAINT\s+"?(\w+)"?\s+CHECK\s*\(([\s\S]*)\)\s*(?:NOT\s+VALID\s*)?$/i.exec(stmt);
  if (added) checks.set(added[1], { table, body: added[2].replace(/\s+/g, " ").trim() });
  const renamed = /RENAME\s+CONSTRAINT\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/i.exec(stmt);
  if (renamed && checks.has(renamed[1])) {
    checks.set(renamed[2], checks.get(renamed[1])!);
    checks.delete(renamed[1]);
  }
}

/** The CHECK constraints as each migration leaves them, in order. */
function checksAfterEach(migrations: { file: string; sql: string }[]): { file: string; checks: Map<string, Check> }[] {
  const checks = new Map<string, Check>();
  return migrations.map((m) => {
    for (const stmt of statements(m.sql)) applyToChecks(checks, stmt);
    return { file: m.file, checks: new Map(checks) };
  });
}

/** Each table's enum-typed columns, from schema.prisma (no field here uses @map). */
function enumColumns(): Map<string, Set<string>> {
  const schema = readFileSync(join(__dirname, "schema.prisma"), "utf8");
  const enums = new Set([...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]));
  const out = new Map<string, Set<string>>();
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const table = /@@map\("([^"]+)"\)/.exec(m[2])?.[1] ?? m[1];
    const columns = new Set<string>();
    for (const f of m[2].matchAll(/^\s+(\w+)\s+(\w+)/gm)) if (enums.has(f[2])) columns.add(f[1]);
    out.set(table, columns);
  }
  return out;
}

/**
 * The enum columns a CHECK body compares as the enum itself, not as text. Such
 * a CHECK depends on the enum type, and rebuilding the type (rename to _old,
 * create again, ALTER COLUMN … TYPE) fails with "operator does not exist".
 */
function enumColumnsNotAsText(body: string, columns: Iterable<string>): string[] {
  return [...columns].filter((col) =>
    [...body.matchAll(new RegExp(`"?\\b${col}\\b"?`, "g"))].some(
      (occ) => !/^\s*::\s*text\b/i.test(body.slice(occ.index + occ[0].length))
    )
  );
}

/** Whether a statement drops `column` of `table` (ALTER TABLE … DROP [COLUMN], any of its actions). */
function dropsColumn(stmt: string, table: string, column: string): boolean {
  const m = new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${ident(table)}([\\s\\S]*)$`, "i").exec(stmt);
  return !!m && new RegExp(`\\bDROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?"?${column}"?(?=[\\s,]|$)`, "i").test(m[1]);
}

describe("CHECK constraints que Prisma no puede modelar", () => {
  const migrations = migrationSql();

  for (const c of PROTECTED_CONSTRAINTS) {
    it(`${c.name} se crea en alguna migración`, () => {
      const created = migrations.some((m) =>
        new RegExp(`ADD\\s+CONSTRAINT\\s+"${c.name}"\\s+CHECK`, "i").test(m.sql)
      );
      expect(created, `falta el ADD CONSTRAINT — ${c.purpose}`).toBe(true);
    });

    // Dropping it is allowed only in a migration that leaves it in place again
    // — re-created, or a replacement renamed to its name — as
    // 20261115120000_task_canvas_check_as_text does. A DROP alone is what
    // `prisma migrate dev` generates for an object it cannot see.
    it(`ninguna migración deja la base sin ${c.name}`, () => {
      const states = checksAfterEach(migrations);
      const from = states.findIndex((s) => s.checks.has(c.name));
      const lost = states
        .slice(from)
        .filter((s) => s.checks.get(c.name)?.table !== c.table)
        .map((s) => s.file);
      expect(
        lost,
        `una migración dropea este constraint y no lo deja de vuelta — ${c.purpose}. ` +
          `Si prisma migrate dev lo generó, borrá esa línea del SQL antes de commitear.`
      ).toEqual([]);
    });

    it(`${c.name} descansa en ${c.table} (${c.columns.join(", ")})`, () => {
      const final = checksAfterEach(migrations).at(-1)!.checks.get(c.name);
      expect(final, "falta el ADD CONSTRAINT").toBeDefined();
      expect(final!.table).toBe(c.table);
      for (const col of c.columns) expect(final!.body, col).toMatch(new RegExp(`\\b${col}\\b`));
    });

    it(`${c.name} compara sus columnas enum como texto`, () => {
      const final = checksAfterEach(migrations).at(-1)!.checks.get(c.name)!;
      const enums = enumColumns().get(c.table) ?? new Set<string>();
      expect(
        enumColumnsNotAsText(final.body, enums),
        `compará la columna como "col"::text: comparada como enum, el CHECK impide reconstruir ese tipo`
      ).toEqual([]);
    });

    it(`ninguna migración posterior se lleva ${c.name} con su tabla o sus columnas`, () => {
      const at = migrations.findIndex((m) => new RegExp(`ADD\\s+CONSTRAINT\\s+"${c.name}"\\s+CHECK`, "i").test(m.sql));
      const later = migrations.slice(at + 1).filter((m) =>
        statements(m.sql).some(
          (st) => dropsTable(st, c.table) || c.columns.some((col) => dropsColumn(st, c.table, col))
        )
      );
      expect(
        later.map((m) => m.file),
        `una migración dropea "${c.table}" o una de sus columnas ${c.columns.join(", ")}, ` +
          `y con eso este constraint — ${c.purpose}.`
      ).toEqual([]);
    });
  }

  // El simulador que decide si una migración deja la base sin el constraint.
  it("sigue el ciclo de un CHECK: agregar, dropear, reemplazar, renombrar", () => {
    const run = (...sql: string[]) => checksAfterEach([{ file: "x", sql: sql.join(";\n") }]).at(-1)!.checks;
    const add = (name: string, body: string) => `ALTER TABLE "T" ADD CONSTRAINT "${name}" CHECK (${body})`;
    expect(run(add("c", `"a" = 1`)).get("c")).toEqual({ table: "T", body: `"a" = 1` });
    expect(run(add("c", "a = 1"), `ALTER TABLE "T" DROP CONSTRAINT "c"`).has("c")).toBe(false);
    expect(run(add("c", "a = 1"), `ALTER TABLE "T" DROP CONSTRAINT IF EXISTS c`, add("c", "a = 2")).get("c")?.body).toBe("a = 2");
    const replaced = run(
      add("c", "a = 1"),
      add("c_new", "a::text = '1'"),
      `ALTER TABLE "T" DROP CONSTRAINT "c"`,
      `ALTER TABLE "T" RENAME CONSTRAINT "c_new" TO "c"`
    );
    expect([...replaced.keys()]).toEqual(["c"]);
    expect(replaced.get("c")?.body).toBe("a::text = '1'");
    expect(run(add("c", "a = 1"), `ALTER TABLE "T" RENAME CONSTRAINT "c" TO "d"`).has("c")).toBe(false);
    expect(run(add("c", "a = 1"), `DROP TABLE IF EXISTS "T" CASCADE`).has("c")).toBe(false);
    expect(run(add("c", "((a IS NULL) OR (a IN ('x', 'y')))")).get("c")?.body).toBe("((a IS NULL) OR (a IN ('x', 'y')))");
  });

  it("ve una columna enum comparada como enum, y no la que va como texto", () => {
    const cols = ["category", "note_format"];
    expect(enumColumnsNotAsText(`"category" = 'note' OR "note_format" = 'text'`, cols)).toEqual(cols);
    expect(enumColumnsNotAsText(`"category"::text = 'note' OR "note_format" = 'text'`, cols)).toEqual(["note_format"]);
    expect(enumColumnsNotAsText(`"category"::text = 'note' OR note_format :: TEXT = 'text'`, cols)).toEqual([]);
    expect(enumColumns().get("Task")).toEqual(new Set(["category", "note_format", "status"]));
    expect(enumColumns().get("ApiToken")?.has("kind")).toBe(true);
  });

  // Si el guard de arriba dejara de reconocer un DROP real, pasaría para siempre.
  it("reconoce los drops que se llevan un constraint sin nombrarlo, y nada más", () => {
    const yes = [
      [`ALTER TABLE "ApiToken" DROP COLUMN "kind"`, "col"],
      [`ALTER TABLE "ApiToken" ADD COLUMN "x" TEXT,\n  DROP COLUMN "token_prefix"`, "col"],
      [`ALTER TABLE IF EXISTS ONLY public."ApiToken" DROP IF EXISTS kind CASCADE`, "col"],
      [`DROP TABLE "ApiToken"`, "table"],
      [`DROP TABLE IF EXISTS "Other", public."ApiToken" CASCADE`, "table"],
    ] as const;
    for (const [stmt, what] of yes) {
      const hit = what === "table" ? dropsTable(stmt, "ApiToken") : ["kind", "token_prefix"].some((c) => dropsColumn(stmt, "ApiToken", c));
      expect(hit, stmt).toBe(true);
    }
    const no = [
      `ALTER TABLE "ApiToken" ALTER COLUMN "kind" DROP DEFAULT`,
      `ALTER TABLE "ApiToken" ALTER COLUMN "kind" TYPE "ApiTokenKind" USING ("kind"::text::"ApiTokenKind")`,
      `ALTER TABLE "ApiToken" DROP CONSTRAINT "ApiToken_kind_fkey"`,
      `ALTER TABLE "ApiToken" DROP COLUMN "kind_old"`,
      `ALTER TABLE "ApiTokenArchive" DROP COLUMN "kind"`,
      `DROP TABLE "ApiTokenArchive"`,
      `DROP TYPE "ApiTokenKind_old"`,
    ];
    for (const stmt of no) {
      const hit = dropsTable(stmt, "ApiToken") || ["kind", "token_prefix"].some((c) => dropsColumn(stmt, "ApiToken", c));
      expect(hit, stmt).toBe(false);
    }
  });
});

describe("las relaciones que cargan historia contable no cascadean", () => {
  // La API devuelve 409 antes de llegar acá, pero el backstop es la DB: un
  // borrado por Studio, por psql o por una ruta futura no puede llevarse los
  // pagos por delante.
  const sql = migrationSql()
    .map((m) => m.sql)
    .join("\n");

  it.each([
    ["SubscriptionPayment_subscription_id_fkey", "SubscriptionPayment"],
    ["SalaryPayment_person_id_fkey", "SalaryPayment"],
  ])("%s termina en ON DELETE RESTRICT", (constraint) => {
    const statements = [
      ...sql.matchAll(
        new RegExp(
          `ADD CONSTRAINT "${constraint}"[\\s\\S]*?ON DELETE (\\w+)`,
          "g"
        )
      ),
    ];
    expect(statements.length).toBeGreaterThan(0);
    // La última definición es la que queda aplicada.
    expect(statements[statements.length - 1][1].toUpperCase()).toBe("RESTRICT");
  });
});

/**
 * The triggers that record deletions for the phone's sync (SyncTombstone).
 *
 * Prisma does not model triggers at all, so it never generates a DROP for
 * them — but it also cannot notice one going missing. Without them nothing
 * fails: deletions simply stop reaching the phone, which keeps showing notes
 * that no longer exist and pushes edits to them forever. The build is the only
 * place that can catch it.
 */
const PROTECTED_TRIGGERS = [
  { trigger: "Task_sync_tombstone", table: "Task", fn: "sync_tombstone_issue" },
  { trigger: "CanvasNode_sync_tombstone", table: "CanvasNode", fn: "sync_tombstone_canvas" },
  { trigger: "CanvasEdge_sync_tombstone", table: "CanvasEdge", fn: "sync_tombstone_canvas" },
];

describe("triggers de borrado que alimentan la sync del teléfono", () => {
  const migrations = migrationSql();

  for (const t of PROTECTED_TRIGGERS) {
    it(`${t.trigger} se crea AFTER DELETE sobre "${t.table}" y llama a ${t.fn}`, () => {
      const created = migrations.some((m) =>
        new RegExp(
          `CREATE\\s+TRIGGER\\s+"${t.trigger}"\\s+AFTER\\s+DELETE\\s+ON\\s+"${t.table}"\\s+FOR\\s+EACH\\s+ROW\\s+EXECUTE\\s+FUNCTION\\s+"${t.fn}"`,
          "i"
        ).test(m.sql)
      );
      expect(created, "falta el CREATE TRIGGER — los borrados no llegarían al teléfono").toBe(true);
    });

    it(`ninguna migración dropea ni desactiva ${t.trigger}`, () => {
      const touched = migrations.filter(
        (m) =>
          new RegExp(`DROP\\s+TRIGGER\\s+(IF\\s+EXISTS\\s+)?"?${t.trigger}"?`, "i").test(m.sql) ||
          new RegExp(`DISABLE\\s+TRIGGER\\s+("?${t.trigger}"?|ALL|USER)`, "i").test(m.sql)
      );
      expect(
        touched.map((d) => d.file),
        "una migración dropea o desactiva un trigger de la sync: los borrados dejarían de llegar al teléfono"
      ).toEqual([]);
    });
  }

  for (const fn of [...new Set(PROTECTED_TRIGGERS.map((t) => t.fn))]) {
    it(`la función ${fn} se crea y ninguna migración la dropea`, () => {
      expect(
        migrations.some((m) => new RegExp(`CREATE\\s+FUNCTION\\s+"${fn}"\\s*\\(`, "i").test(m.sql))
      ).toBe(true);
      const dropped = migrations.filter((m) =>
        new RegExp(`DROP\\s+FUNCTION\\s+(IF\\s+EXISTS\\s+)?"?${fn}"?`, "i").test(m.sql)
      );
      expect(dropped.map((d) => d.file)).toEqual([]);
    });
  }

  it("detecta un DROP TRIGGER real (el guard no es ciego)", () => {
    const sql = stripSqlComments(`DROP TRIGGER IF EXISTS "Task_sync_tombstone" ON "Task";`);
    expect(/DROP\s+TRIGGER\s+(IF\s+EXISTS\s+)?"?Task_sync_tombstone"?/i.test(sql)).toBe(true);
  });
});

// La cabeza de un token readonly la decide el código (lib/readonly-token.ts) y
// la hace cumplir la base (ApiToken_readonly_prefix). Si una cambia sin la
// otra, el CHECK protege una cabeza que nadie emite — o rechaza las que sí.
describe("ApiToken_readonly_prefix exige la cabeza que emite el código", () => {
  const added = migrationSql()
    .map((m) => /ADD\s+CONSTRAINT\s+"ApiToken_readonly_prefix"\s+CHECK\s*\(([\s\S]*?)\);/i.exec(m.sql)?.[1])
    .filter((body): body is string => body !== undefined);

  it("se agrega una sola vez", () => {
    expect(added).toHaveLength(1);
  });

  it("solo restringe a los readonly, y con LIKE escapado", () => {
    const body = added[0].replace(/\s+/g, " ").trim();
    const pattern = `${READONLY_TOKEN_PREFIX.replace(/_/g, "\\_")}%`;
    // `::text`: so the CHECK survives rebuilding the ApiTokenKind enum (see the migration).
    expect(body).toBe(`"kind"::text <> 'readonly' OR "token_prefix" LIKE '${pattern}'`);
  });
});
