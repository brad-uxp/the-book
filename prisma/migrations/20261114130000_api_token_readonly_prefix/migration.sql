-- Every read-only token starts with `tbro_` (lib/readonly-token.ts), and the
-- database holds that, not only the code that mints tokens.
--
-- What keeps a read-only token from writing after a rollback is its head, not
-- the code that knows the kind: builds older than 595f29c take only `tb_`
-- tokens (bearerFromHeader), so a `tbro_` one is a 401 there. A `readonly` row
-- with a `tb_` head — fc398db, in production before 595f29c, minted them —
-- would be accepted by those builds, and one older than fc398db treats every
-- kind it does not refuse by name as the owner. This CHECK makes such a row
-- impossible, whichever build writes it.
--
-- No row changes. None is `readonly` today. If one were, with any other head,
-- this migration fails — Postgres checks the existing rows when the
-- constraint is added — instead of deleting or rewriting it: a person decides
-- what happens to that token, then deploys again.
--
-- Not expressible in schema.prisma; prisma/migrations.test.ts keeps a
-- `prisma migrate dev` from dropping it. In LIKE the backslash is the escape:
-- `\_` is an underscore, not "any one character".

-- AddCheckConstraint
ALTER TABLE "ApiToken"
  ADD CONSTRAINT "ApiToken_readonly_prefix"
  CHECK ("kind" <> 'readonly' OR "token_prefix" LIKE 'tbro\_%');
