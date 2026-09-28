-- What each API token is for, so the phone's sync can accept only the
-- phone's tokens (and the browser) and not the hand-made automation ones.
-- Additive: a new enum, a new column with a default, and a backfill.

-- CreateEnum
CREATE TYPE "ApiTokenKind" AS ENUM ('mobile', 'automation');

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "kind" "ApiTokenKind" NOT NULL DEFAULT 'automation';

-- Tokens minted by the app's sign-in so far: named "mobile · <device>"
-- (lib/mobile-auth.ts mobileTokenName). From here on the sign-in sets the
-- kind itself.
UPDATE "ApiToken" SET "kind" = 'mobile' WHERE "name" LIKE 'mobile · %';
