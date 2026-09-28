-- Sync for the mobile app's offline notes: a record of deletions, the
-- answers to pushed changes, and the indexes "what changed since" reads.
--
-- Strictly additive: two new tables, two trigger functions, three triggers,
-- five indexes. No existing row is read, moved or deleted.
--
-- HAND-WRITTEN from `prisma migrate diff` (schema before → after), not from
-- `migrate dev`, which diffs against the live database and opens with a DROP
-- of the partial unique index on SubscriptionPayment — the one that stops a
-- period being paid twice. `pnpm start` applies migrations unattended, so that
-- line must never be committed. prisma/migrations.test.ts guards it.

-- One row per deleted issue, idea or connection. Filled only by the triggers
-- below; purged by the daily job after 60 days.
CREATE TABLE "SyncTombstone" (
    "id" BIGSERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "issue_id" TEXT,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncTombstone_pkey" PRIMARY KEY ("id")
);

-- The stored answer to each pushed change, so a retried push is not applied
-- twice. Purged by the daily job after 30 days.
CREATE TABLE "SyncMutation" (
    "mutation_id" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncMutation_pkey" PRIMARY KEY ("mutation_id")
);

CREATE INDEX "SyncTombstone_deleted_at_id_idx" ON "SyncTombstone"("deleted_at", "id");

CREATE INDEX "SyncMutation_created_at_idx" ON "SyncMutation"("created_at");

CREATE INDEX "Task_updated_at_id_idx" ON "Task"("updated_at", "id");

CREATE INDEX "CanvasNode_updated_at_id_idx" ON "CanvasNode"("updated_at", "id");

CREATE INDEX "CanvasEdge_created_at_id_idx" ON "CanvasEdge"("created_at", "id");

-- Deletions, recorded by the database itself. A trigger sees every way a row
-- goes — a route, the bulk delete, a cascade from its issue or its idea,
-- Prisma Studio, psql — where application code would only see the paths
-- someone remembered to instrument. Prisma cannot see triggers:
-- prisma/migrations.test.ts fails the build if a migration drops one.
--
-- clock_timestamp(), not now(): now() is when the transaction STARTED, and a
-- long one would date its deletions earlier than a phone may already have
-- pulled past. The pull's overlap window covers what is left.

CREATE FUNCTION "sync_tombstone_issue"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "SyncTombstone" ("entity", "entity_id", "issue_id", "deleted_at")
  VALUES ('issue', OLD."id", OLD."id", clock_timestamp());
  RETURN OLD;
END;
$$;

-- Ideas and connections: the entity name comes from the trigger's argument.
CREATE FUNCTION "sync_tombstone_canvas"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "SyncTombstone" ("entity", "entity_id", "issue_id", "deleted_at")
  VALUES (TG_ARGV[0], OLD."id", OLD."issue_id", clock_timestamp());
  RETURN OLD;
END;
$$;

CREATE TRIGGER "Task_sync_tombstone"
  AFTER DELETE ON "Task"
  FOR EACH ROW EXECUTE FUNCTION "sync_tombstone_issue"();

CREATE TRIGGER "CanvasNode_sync_tombstone"
  AFTER DELETE ON "CanvasNode"
  FOR EACH ROW EXECUTE FUNCTION "sync_tombstone_canvas"('canvas_node');

CREATE TRIGGER "CanvasEdge_sync_tombstone"
  AFTER DELETE ON "CanvasEdge"
  FOR EACH ROW EXECUTE FUNCTION "sync_tombstone_canvas"('canvas_edge');
