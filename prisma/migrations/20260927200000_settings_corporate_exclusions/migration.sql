-- Clients left out of corporate profitability, saved instead of re-picked.
--
-- The dashboard's corporate chart used to exclude clients from a popover
-- that forgot the choice on every reload, and the mobile Metrics tab reads
-- the same numbers over GET /api/metrics — so the choice has to live in the
-- database, shared by both.
--
-- Strictly additive: one column with a default. The existing Settings row
-- gets an empty list, which is exactly today's behaviour (nothing excluded).
--
-- HAND-WRITTEN from `prisma migrate diff` (schema before → after). No DROP of
-- the SubscriptionPayment partial unique index; prisma/migrations.test.ts
-- guards it.

ALTER TABLE "Settings" ADD COLUMN "corporate_excluded_client_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
