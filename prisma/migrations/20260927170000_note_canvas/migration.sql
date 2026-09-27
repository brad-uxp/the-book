-- Canvas notes: a note can be one rich-text document (as before) or a canvas
-- of connected ideas, each idea holding its own rich text.
--
-- Strictly additive. One enum, one column with a default (every existing
-- issue becomes `text`, which is exactly what it already is), two new tables.
-- No existing row is read, moved or deleted.
--
-- HAND-WRITTEN from `prisma migrate diff` (schema before → after), not from
-- `migrate dev`, which diffs against the live database and opens with a DROP
-- of the partial unique index on SubscriptionPayment — the one that stops a
-- period being paid twice. `pnpm start` applies migrations unattended, so that
-- line must never be committed. prisma/migrations.test.ts guards it.

CREATE TYPE "NoteFormat" AS ENUM ('text', 'canvas');

ALTER TABLE "Task" ADD COLUMN "note_format" "NoteFormat" NOT NULL DEFAULT 'text';

-- Only a note can be a canvas. Every rule that keeps a canvas off the board,
-- out of the archive and away from the daily job is keyed on
-- category = 'note', so a canvas task would slip through all of them.
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_canvas_only_for_notes"
  CHECK ("category" = 'note' OR "note_format" = 'text');

-- One idea on a canvas note. content is TipTap HTML, like Task.description.
CREATE TABLE "CanvasNode" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "color" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 280,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 160,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasNode_pkey" PRIMARY KEY ("id")
);

-- A directed connection between two ideas of the same canvas.
CREATE TABLE "CanvasEdge" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasEdge_pkey" PRIMARY KEY ("id")
);

-- Target of the edges' compound foreign keys; also the "nodes of this
-- canvas" index, since issue_id leads.
CREATE UNIQUE INDEX "CanvasNode_issue_id_id_key" ON "CanvasNode"("issue_id", "id");

CREATE INDEX "CanvasEdge_issue_id_target_id_idx" ON "CanvasEdge"("issue_id", "target_id");

CREATE UNIQUE INDEX "CanvasEdge_issue_id_source_id_target_id_key" ON "CanvasEdge"("issue_id", "source_id", "target_id");

ALTER TABLE "CanvasNode" ADD CONSTRAINT "CanvasNode_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CanvasEdge" ADD CONSTRAINT "CanvasEdge_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Compound keys: both ends must be nodes of THIS canvas. An edge between two
-- notes' ideas is impossible here, not merely rejected by the API.
ALTER TABLE "CanvasEdge" ADD CONSTRAINT "CanvasEdge_issue_id_source_id_fkey" FOREIGN KEY ("issue_id", "source_id") REFERENCES "CanvasNode"("issue_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CanvasEdge" ADD CONSTRAINT "CanvasEdge_issue_id_target_id_fkey" FOREIGN KEY ("issue_id", "target_id") REFERENCES "CanvasNode"("issue_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CanvasEdge"
  ADD CONSTRAINT "CanvasEdge_no_self_link" CHECK ("source_id" <> "target_id");
