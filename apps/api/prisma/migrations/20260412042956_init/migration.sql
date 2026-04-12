-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "memory_type" AS ENUM ('TaskPattern', 'FileConvention', 'TeamConvention', 'GatePattern', 'RiskSignal', 'RepoMap');

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "harness_members" (
    "user_id" UUID NOT NULL,
    "harness_id" UUID NOT NULL,

    CONSTRAINT "harness_members_pkey" PRIMARY KEY ("user_id","harness_id")
);

-- CreateTable
CREATE TABLE "harnesses" (
    "harness_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harnesses_pkey" PRIMARY KEY ("harness_id")
);

-- CreateTable
CREATE TABLE "runs" (
    "run_id" UUID NOT NULL,
    "harness_id" UUID NOT NULL,
    "temporal_workflow_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "current_phase" TEXT NOT NULL,
    "pipeline_position" INTEGER,
    "pipeline_artifact" JSONB,
    "failure_reason" TEXT,
    "failure_detail" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "phase_artifacts" (
    "artifact_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "artifact_type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phase_artifacts_pkey" PRIMARY KEY ("artifact_id")
);

-- CreateTable
CREATE TABLE "gate_events" (
    "gate_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "harness_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "pipeline_position" INTEGER NOT NULL,
    "fired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gap_description" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "temporal_workflow_id" TEXT NOT NULL,
    "timeout_ms" BIGINT NOT NULL DEFAULT 172800000,
    "resolved_at" TIMESTAMPTZ,
    "resolution" JSONB,

    CONSTRAINT "gate_events_pkey" PRIMARY KEY ("gate_id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "event_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID,
    "harness_id" UUID,
    "phase" TEXT,
    "event_type" TEXT NOT NULL,
    "actor" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "connector_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "harness_id" UUID NOT NULL,
    "connector_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "config_encrypted" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("connector_id")
);

-- CreateTable
CREATE TABLE "agent_configs" (
    "agent_config_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "harness_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "agent_id" TEXT NOT NULL,
    "llm_connector_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "max_tokens" INTEGER NOT NULL DEFAULT 4096,
    "system_prompt_body" TEXT NOT NULL DEFAULT '',
    "skills" JSONB NOT NULL DEFAULT '[]',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "agent_configs_pkey" PRIMARY KEY ("agent_config_id")
);

-- CreateTable
CREATE TABLE "skills" (
    "skill_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "harness_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "applicable_phases" TEXT[],
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("skill_id")
);

-- CreateTable
CREATE TABLE "rules" (
    "rule_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "harness_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "applicable_phases" TEXT[],
    "constraint_text" TEXT NOT NULL,
    "enforcement" TEXT NOT NULL,
    "pattern_type" TEXT NOT NULL,
    "patterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("rule_id")
);

-- CreateTable
CREATE TABLE "memory_records" (
    "memory_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "harness_id" UUID NOT NULL,
    "type" "memory_type" NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "source_run_id" UUID,
    "relevance_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_records_pkey" PRIMARY KEY ("memory_id")
);

-- CreateTable
CREATE TABLE "memory_staging" (
    "staging_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "harness_id" UUID NOT NULL,
    "type" "memory_type" NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "relevance_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_staging_pkey" PRIMARY KEY ("staging_id")
);

-- CHECK constraints from SDD 15.1
ALTER TABLE "runs" ADD CONSTRAINT "runs_status_check" CHECK (status IN ('RUNNING','WAITING_FOR_HUMAN','STALLED','COMPLETED','FAILED'));
ALTER TABLE "runs" ADD CONSTRAINT "runs_current_phase_check" CHECK (current_phase IN ('TRIGGER','ACQUIRE','PLAN','EXECUTE','SHIP'));
ALTER TABLE "rules" ADD CONSTRAINT "rules_enforcement_check" CHECK (enforcement IN ('hard', 'soft'));
ALTER TABLE "rules" ADD CONSTRAINT "rules_pattern_type_check" CHECK (pattern_type IN ('path', 'regex', 'semantic'));

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "runs_harness_status" ON "runs"("harness_id", "status");

-- CreateIndex
CREATE INDEX "runs_harness_started" ON "runs"("harness_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "runs_harness_phase" ON "runs"("harness_id", "current_phase");

-- CreateIndex
CREATE INDEX "phase_artifacts_run_phase" ON "phase_artifacts"("run_id", "phase");

-- CreateIndex
CREATE INDEX "gate_events_run" ON "gate_events"("run_id");

-- CreateIndex
CREATE INDEX "audit_events_run" ON "audit_events"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_harness" ON "audit_events"("harness_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "memory_records_harness_content_hash" ON "memory_records"("harness_id", "content_hash");

-- CreateIndex
CREATE INDEX "memory_staging_run" ON "memory_staging"("run_id");

-- Audit log immutability (append-only enforced at DB layer)
CREATE RULE no_audit_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE no_audit_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;

-- HNSW index for fast cosine similarity search on memory embeddings
CREATE INDEX memory_embedding_hnsw
  ON memory_records USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Partial index for open gate thread lookups
CREATE INDEX gate_events_open_thread
  ON gate_events((source->>'channelId'), (source->>'threadTs'), resolved_at)
  WHERE resolved_at IS NULL;

-- AddForeignKey
ALTER TABLE "harness_members" ADD CONSTRAINT "harness_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harness_members" ADD CONSTRAINT "harness_members_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_artifacts" ADD CONSTRAINT "phase_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_staging" ADD CONSTRAINT "memory_staging_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_staging" ADD CONSTRAINT "memory_staging_harness_id_fkey" FOREIGN KEY ("harness_id") REFERENCES "harnesses"("harness_id") ON DELETE RESTRICT ON UPDATE CASCADE;
