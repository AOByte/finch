-- CreateTable: mcp_servers (base from Wave 5A, needed if not already present)
CREATE TABLE IF NOT EXISTS "mcp_servers" (
    "mcp_server_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "harness_id" UUID NOT NULL,
    "server_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "config_encrypted" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "health_status" TEXT NOT NULL DEFAULT 'unknown',
    "last_health_check" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("mcp_server_id")
);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "mcp_servers_harness" ON "mcp_servers"("harness_id", "is_active");

-- AddForeignKey (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_servers_harness_id_fkey'
  ) THEN
    ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_harness_id_fkey"
      FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterTable: Add external MCP transport fields to mcp_servers
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "transport" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "command" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "command_args" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "endpoint_url" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "env_encrypted" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "permission_overrides" JSONB;

-- AlterTable: Add OAuth fields to mcp_servers
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_provider_id" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "access_token_encrypted" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "refresh_token_encrypted" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "token_expires_at" TIMESTAMPTZ;

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
