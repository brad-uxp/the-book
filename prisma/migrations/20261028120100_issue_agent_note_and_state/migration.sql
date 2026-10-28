-- Agents on issues (docs/product/features/agentes-y-mcp.md, F1).
--
-- Task.agent_note: an agent's latest pass and the owner's answers, as TipTap
-- HTML. A constant default, so adding it rewrites no rows.
-- IssueAgentState: what an agent keeps between passes — its log, the note it
-- last wrote, the description it last saw, its folder and session. A table of
-- its own so writing it never moves Task.updated_at, which the phone's sync
-- pulls by. Goes with its issue (ON DELETE CASCADE).
--
-- Additive: one column and one table.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "agent_note" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "IssueAgentState" (
    "issue_id" TEXT NOT NULL,
    "log" TEXT NOT NULL DEFAULT '',
    "last_note" TEXT,
    "description_seen" TEXT,
    "work_dir" TEXT,
    "session_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueAgentState_pkey" PRIMARY KEY ("issue_id")
);

-- AddForeignKey
ALTER TABLE "IssueAgentState" ADD CONSTRAINT "IssueAgentState_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
