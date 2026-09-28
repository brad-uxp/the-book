-- Binds a pushed change's id to what it carried, so reusing an id with
-- other contents is refused instead of answered with the first change's
-- result. Nullable: answers stored before this have no hash and replay as
-- they always did. Additive.

-- AlterTable
ALTER TABLE "SyncMutation" ADD COLUMN     "payload_hash" TEXT;
