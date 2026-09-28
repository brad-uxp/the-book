-- In-app updates for the Android app: the builds the release script
-- registers, offered to the phone once published. Additive: a new table; no
-- existing row is read or changed.

-- CreateTable
CREATE TABLE "MobileRelease" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "version_code" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "r2_key" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "MobileRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileRelease_version_code_key" ON "MobileRelease"("version_code");

-- CreateIndex
CREATE INDEX "MobileRelease_published_at_version_code_idx" ON "MobileRelease"("published_at", "version_code");
