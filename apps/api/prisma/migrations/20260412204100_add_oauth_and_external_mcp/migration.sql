-- AlterTable: Add external MCP transport fields to mcp_servers
ALTER TABLE "mcp_servers" ADD COLUMN "transport" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "command" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "command_args" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "mcp_servers" ADD COLUMN "endpoint_url" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "env_encrypted" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "permission_overrides" JSONB;

-- AlterTable: Add OAuth fields to mcp_servers
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_provider_id" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "access_token_encrypted" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "refresh_token_encrypted" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "token_expires_at" TIMESTAMPTZ;

-- CreateTable: oauth_states for OAuth PKCE flow
CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state" TEXT NOT NULL,
    "harness_id" UUID NOT NULL,
    "provider_id" TEXT NOT NULL,
    "code_verifier" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");
CREATE INDEX "oauth_states_expires" ON "oauth_states"("expires_at");
