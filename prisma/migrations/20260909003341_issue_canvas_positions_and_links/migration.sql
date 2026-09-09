-- Canvas view for issues: where each card sits, and which cards are wired
-- together.
--
-- Strictly additive. Two nullable columns on "Task" (an ADD COLUMN with no
-- default does not rewrite the table) and one new table. No existing row is
-- read, moved or deleted by this migration.
--
-- HAND-EDITED. `prisma migrate dev` generated a
--   DROP INDEX "SubscriptionPayment_subscription_id_due_date_active_key";
-- as the first statement, because that partial unique index cannot be
-- expressed in schema.prisma and Prisma therefore reads it as drift. It is the
-- index that stops a subscription period from being paid twice, and
-- `pnpm start` runs `migrate deploy` on every boot — so committing that line
-- would have removed it from production with no human step in between.
-- The line is deliberately absent. prisma/migrations.test.ts guards it.

-- Position on the canvas. NULL means "never placed": the canvas lays the issue
-- out on a grid the first time it renders and persists the result, so issues
-- created before this migration (and issues created later from the board or
-- the list) still show up.
ALTER TABLE "Task" ADD COLUMN "canvas_x" DOUBLE PRECISION,
                   ADD COLUMN "canvas_y" DOUBLE PRECISION;

-- A directed edge between two issues.
CREATE TABLE "IssueLink" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IssueLink_target_id_idx" ON "IssueLink"("target_id");

-- One edge per ordered pair. The API checks first and returns 409, but the
-- check-then-insert is not atomic: two rapid drags of the same connection
-- would both pass it.
CREATE UNIQUE INDEX "IssueLink_source_id_target_id_key" ON "IssueLink"("source_id", "target_id");

-- Cascade on both sides. Unlike payments, an edge is not accounting history —
-- an edge whose issue is gone points at nothing and would render as a dangling
-- line. Deleting an issue is already a deliberate, confirmed action in the UI.
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An issue cannot link to itself: React Flow will happily emit a source ==
-- target connection if a handle is dragged back onto its own card, and the
-- resulting self-loop is unreachable in the UI. Prisma cannot express a CHECK,
-- so this constraint is manually managed — it is listed in the header of
-- schema.prisma and guarded by prisma/migrations.test.ts.
ALTER TABLE "IssueLink"
  ADD CONSTRAINT "IssueLink_no_self_link" CHECK ("source_id" <> "target_id");
