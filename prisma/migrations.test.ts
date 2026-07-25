import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Two indexes in this database cannot be expressed in schema.prisma:
 *
 *  - a PARTIAL unique (uniqueness only among non-soft-deleted payments)
 *  - a FUNCTIONAL unique (case-insensitive invoice numbers)
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

function migrationSql(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => statSync(join(MIGRATIONS_DIR, d)).isDirectory())
    .sort()
    .map((dir) => {
      const file = join(dir, "migration.sql");
      return { file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") };
    });
}

describe("índices críticos que Prisma no puede modelar", () => {
  const migrations = migrationSql();

  it("hay migraciones que leer", () => {
    expect(migrations.length).toBeGreaterThan(0);
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
