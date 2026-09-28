-- Native push (phase 5): the phones that receive push notifications.
--
-- Additive: one new table, its indexes and a foreign key to ApiToken. Nothing
-- existing is read, changed or dropped.
--
-- Hand-written from `prisma migrate diff`, WITHOUT the `DROP TABLE
-- "PushSubscription"` that diff also emits: PushSubscription left
-- schema.prisma in this same change (phase 1 of its two-phase drop) but its
-- table stays until the next deploy's migration, which drops it with
-- ACEPTO PERDER ESTOS DATOS.

-- CreateTable
CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "api_token_id" TEXT NOT NULL,
    "fcm_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_api_token_id_key" ON "MobileDevice"("api_token_id");

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_fcm_token_key" ON "MobileDevice"("fcm_token");

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_api_token_id_fkey" FOREIGN KEY ("api_token_id") REFERENCES "ApiToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
