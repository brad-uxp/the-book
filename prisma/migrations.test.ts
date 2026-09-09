import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Several database objects cannot be expressed in schema.prisma:
 *
 *  - a PARTIAL unique (uniqueness only among non-soft-deleted payments)
 *  - a FUNCTIONAL unique (case-insensitive invoice numbers)
 *  - CHECK constraints (the settings singleton, the no-self-link on IssueLink)
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

const PROTECTED_CONSTRAINTS = [
  {
    name: "settings_singleton_check",
    purpose: "keeps Settings to a single row",
  },
  {
    name: "IssueLink_no_self_link",
    purpose: "stops an issue from linking to itself on the canvas",
  },
];

describe("CHECK constraints que Prisma no puede modelar", () => {
  const migrations = migrationSql();

  for (const c of PROTECTED_CONSTRAINTS) {
    it(`${c.name} se crea en alguna migración`, () => {
      const created = migrations.some((m) =>
        new RegExp(`ADD\\s+CONSTRAINT\\s+"${c.name}"\\s+CHECK`, "i").test(m.sql)
      );
      expect(created, `falta el ADD CONSTRAINT — ${c.purpose}`).toBe(true);
    });

    it(`ninguna migración dropea ${c.name}`, () => {
      const dropped = migrations.filter((m) =>
        new RegExp(
          `DROP\\s+CONSTRAINT\\s+(IF\\s+EXISTS\\s+)?"?${c.name}"?`,
          "i"
        ).test(m.sql)
      );
      expect(
        dropped.map((d) => d.file),
        `una migración dropea este constraint — ${c.purpose}. ` +
          `Si prisma migrate dev lo generó, borrá esa línea del SQL antes de commitear.`
      ).toEqual([]);
    });
  }
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
