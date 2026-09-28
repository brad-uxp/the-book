-- A kind of API token for the release script: it can publish builds of the
-- Android app (POST /api/mobile/releases) and is refused by every other
-- route (lib/api.ts). Additive: one enum value; no row changes.

-- AlterEnum
ALTER TYPE "ApiTokenKind" ADD VALUE 'release';
