-- Bearer credentials for machine clients (see model ApiToken).
--
-- The secret itself is never stored: token_prefix is the readable head used as
-- the lookup key, token_hash is a SHA-256 of the whole token. Verification is
-- one indexed read followed by a timing-safe comparison.

CREATE TABLE "ApiToken" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash"   TEXT NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "expires_at"   TIMESTAMP(3),
    "revoked_at"   TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiToken_token_prefix_key" ON "ApiToken"("token_prefix");
CREATE INDEX "ApiToken_revoked_at_idx" ON "ApiToken"("revoked_at");
