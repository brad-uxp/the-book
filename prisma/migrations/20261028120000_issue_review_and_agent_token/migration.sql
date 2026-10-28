-- Agents on issues (docs/product/features/agentes-y-mcp.md, F1).
--
-- `review`: the owner's turn — an agent left questions or a delivery in the
-- issue's agent_note. Placed after in_progress, where the board shows it.
-- `agent`: a kind of API token that may only read issues and write an agent's
-- fields on them (lib/issues-service.ts); every other route refuses it
-- (lib/api.ts).
--
-- Additive: two enum values, no row changes. In a migration of their own: a
-- value added by ALTER TYPE cannot be used in the transaction that adds it.

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'review' AFTER 'in_progress';

-- AlterEnum
ALTER TYPE "ApiTokenKind" ADD VALUE 'agent';
