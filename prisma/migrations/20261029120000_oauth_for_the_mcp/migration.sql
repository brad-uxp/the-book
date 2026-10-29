-- theBook as the OAuth authorization server of its own MCP
-- (docs/product/features/agentes-y-mcp.md, F3).
--
-- OAuthGrant: a connection — what the owner allowed on the consent screen,
-- for one client and one resource. Revoked, never deleted.
-- OAuthCode: an authorization code, hashed, single use, a minute long.
-- OAuthRefreshToken: a connection's refresh tokens, hashed, rotated on use.
-- ApiToken.oauth_grant_id / audience: an OAuth access token is an ApiToken
-- (kind agent, one hour) tied to its connection and bound to the MCP's URL.
-- Everything goes with its connection (ON DELETE CASCADE). The CHECK keeps
-- the two new ApiToken columns together: a token is OAuth's, bound to the MCP,
-- or neither (prisma/migrations.test.ts guards it; Prisma cannot model it).
--
-- Additive: two nullable columns, three tables, one CHECK that every existing
-- row (both columns null) already meets.

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "oauth_grant_id" TEXT;

-- CreateTable
CREATE TABLE "OAuthGrant" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "OAuthGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthCode" (
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "grant_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("code_hash")
);

-- CreateTable
CREATE TABLE "OAuthRefreshToken" (
    "token_hash" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "OAuthGrant_revoked_at_idx" ON "OAuthGrant"("revoked_at");

-- CreateIndex
CREATE INDEX "OAuthCode_expires_at_idx" ON "OAuthCode"("expires_at");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_grant_id_idx" ON "OAuthRefreshToken"("grant_id");

-- CreateIndex
CREATE INDEX "ApiToken_oauth_grant_id_idx" ON "ApiToken"("oauth_grant_id");

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_oauth_grant_id_fkey" FOREIGN KEY ("oauth_grant_id") REFERENCES "OAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "OAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "OAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_oauth_audience_together" CHECK (("oauth_grant_id" IS NULL) = ("audience" IS NULL));
