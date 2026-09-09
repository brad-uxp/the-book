-- Free-text chips on the issues canvas. Organisational only: not work, no
-- status, never on the board or in the list.
--
-- Strictly additive: one new table. No existing table, row or index is
-- touched by this migration.
--
-- HAND-EDITED, for the same reason as 20260909003341: `prisma migrate dev`
-- opened with a
--   DROP INDEX "SubscriptionPayment_subscription_id_due_date_active_key";
-- because that partial unique index cannot be expressed in schema.prisma and
-- Prisma reads it as drift. It is what stops a subscription period being paid
-- twice, and `pnpm start` applies migrations unattended on every boot. The
-- line is deliberately absent; prisma/migrations.test.ts guards it.

CREATE TABLE "CanvasLabel" (
    "id" TEXT NOT NULL,
    "text" VARCHAR(200) NOT NULL DEFAULT '',
    -- A palette key (lib/canvas-labels.ts), not a hex. Unknown values fall
    -- back to the default when rendered, so no CHECK guards this: the palette
    -- should be free to change without a migration.
    "color" TEXT NOT NULL DEFAULT 'slate',
    "canvas_x" DOUBLE PRECISION NOT NULL,
    "canvas_y" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasLabel_pkey" PRIMARY KEY ("id")
);
