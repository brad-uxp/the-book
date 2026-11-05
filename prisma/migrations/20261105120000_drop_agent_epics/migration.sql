-- Phase 2 of rolling back agents working epics (docs/product/features/
-- agentes-y-mcp.md, "Revertido (2026-11-05)"). Phase 1 shipped the code and
-- schema.prisma without these objects, so no running code reads or writes
-- them during this deploy.
--
-- ACEPTO PERDER ESTOS DATOS: Task.agent_note held an agent's latest pass on a
-- task and Brad's answers to it; IssueAgentState held each agent's log,
-- folder, session link, and the note and description it last saw. The owner
-- rolled that workflow back on 2026-11-05 and nothing has read them since
-- phase 1. Not recoverable except from a database backup. Every task's title,
-- description, status and the rest of its row stay.
--
-- `review` leaves TaskStatus. Postgres cannot drop an enum value, so the type
-- is rebuilt: renamed away, created again without it, the column moved over by
-- its text, its default put back, the old type dropped. Nothing else uses the
-- type, and nothing that the rebuild would break reads Task.status: the
-- SyncTombstone triggers are AFTER DELETE and read OLD."id" only, the CHECK
-- Task_canvas_only_for_notes reads category and note_format, and
-- Task_status_idx is rebuilt by the ALTER itself. Prisma runs a migration in
-- one transaction, so this lands whole or not at all.

-- Safety net: nothing may be left in the value about to go. Phase 1 already
-- dropped the Review column, so such a task has been off the board since.
-- updated_at moves (in UTC, as Prisma stores it) so the phone's sync, which
-- pulls by it, hears about the new status.
UPDATE "Task"
SET "status" = 'in_progress', "updated_at" = (now() AT TIME ZONE 'UTC')
WHERE "status" = 'review';

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "agent_note";

-- DropTable (its foreign key to Task goes with it)
DROP TABLE "IssueAgentState";

-- AlterEnum
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'in_progress', 'blocked', 'done');
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING ("status"::text::"TaskStatus");
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'pending';
DROP TYPE "TaskStatus_old";
