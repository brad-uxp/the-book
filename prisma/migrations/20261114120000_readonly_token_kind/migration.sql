-- A kind of API token that only reads: what an automation token can read
-- (GET and HEAD under /api), and a 403 on every create, change or delete
-- (lib/api.ts, requireSession({ readonly: true }) on the read handlers). For
-- scripts that only need to look at the books, so the token they keep is not
-- one that can change them. Additive: one enum value; no row changes.

-- AlterEnum
ALTER TYPE "ApiTokenKind" ADD VALUE 'readonly';
