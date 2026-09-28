-- Pinned connection sides. A connection can now leave a card from a side the
-- user chose, and arrive at a side of the other: top, right, bottom or left,
-- or NULL for the side facing the other end (every connection made before
-- this). Additive: two nullable columns and an updated_at.
ALTER TABLE "CanvasEdge"
  ADD COLUMN "source_side" TEXT,
  ADD COLUMN "target_side" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- A connection made before now was last changed when it was made.
UPDATE "CanvasEdge" SET "updated_at" = "created_at";

-- The four sides and nothing else. Not expressible in schema.prisma, so
-- prisma/migrations.test.ts keeps it from being dropped.
ALTER TABLE "CanvasEdge"
  ADD CONSTRAINT "CanvasEdge_sides_valid" CHECK (
    ("source_side" IS NULL OR "source_side" IN ('top', 'right', 'bottom', 'left'))
    AND ("target_side" IS NULL OR "target_side" IN ('top', 'right', 'bottom', 'left'))
  );

-- The phone's pull reads connections by their last change now, not their
-- creation: a side can change after the connection exists.
DROP INDEX "CanvasEdge_created_at_id_idx";
CREATE INDEX "CanvasEdge_updated_at_id_idx" ON "CanvasEdge"("updated_at", "id");
