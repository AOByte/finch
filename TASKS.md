# Finch — Task List

Track implementation progress here. Check each task off as it is completed. Do not mark a task done until every condition in the Definition of Done (AGENTS.md section 12) is satisfied.

Before starting any task: read AGENTS.md, RULES.md, and the relevant skill file from `skills/`.

**Current wave: Wave 1 — Foundation**

---

## Wave 1 — Foundation

**Goal:** a running skeleton. No business logic. Everything compiles, infrastructure comes up, NestJS starts, migrations apply cleanly.

- [ ] **W1-01** — Initialise pnpm monorepo. Create `apps/api`, `apps/web`, `packages/types`. Configure `pnpm-workspace.yaml`. Set `"node": ">=20"` in root `package.json` engines field. Add `.nvmrc` with `20`.

- [ ] **W1-02** — Create `infra/docker-compose.yml` with the following services, all using `finch-` prefix, Postgres credentials `finch/finch/finch`:
  - `finch-postgres` — `pgvector/pgvector:pg16`, port 5432, named volume `finch_postgres_data`
  - `finch-redis` — `redis:7-alpine`, port 6379
  - `finch-temporal` — `temporalio/auto-setup:1.24`, port 7233, env `DB=postgresql`, `POSTGRES_USER=finch`, `POSTGRES_PWD=finch`, `POSTGRES_SEEDS=finch-postgres`, depends on `finch-postgres`
  - `finch-temporal-ui` — `temporalio/ui:2.26`, port 8080, env `TEMPORAL_ADDRESS=finch-temporal:7233`
  - Include Docker `healthcheck` blocks for `finch-postgres` and `finch-redis`.

- [ ] **W1-03** — Write `infra/healthcheck.sh`. Must check: `finch-postgres` accepts connections, `finch-redis` responds to PING, `finch-temporal-ui` returns HTTP 200 at `http://localhost:8080`. Exit 0 only when all three pass. Exit 1 with a message identifying which service failed. Verify: `docker compose -f infra/docker-compose.yml up -d` then `bash infra/healthcheck.sh` exits 0.

- [ ] **W1-04** — Scaffold `apps/api` as a NestJS 10 application. Configure `tsconfig.json` with `strict: true`, `strictNullChecks: true`. Install all dependencies from the tech stack table in AGENTS.md section 5. API runs on port 3001.

- [ ] **W1-05** — Create all NestJS module stub files per the module tree in AGENTS.md section 7. Each file must exist, export its module class, and be imported into `AppModule`. No logic in any module yet — stubs only. Modules required: `OrchestratorModule`, `WorkflowModule`, `AgentModule`, `ConnectorModule`, `LLMModule`, `MemoryModule`, `AuditModule`, `PersistenceModule`, `WebSocketModule`, `AuthModule`, `ApiModule`. Verify: `pnpm --filter api exec tsc --noEmit` passes with all modules wired.

- [ ] **W1-06** — Write the Prisma schema at `apps/api/prisma/schema.prisma`. Include the pgvector extension declaration (`datasource` block must reference the `vector` extension). Include all tables from `docs/SDD.md` section 15.1 plus the following auth tables:

  **Auth tables (required for W6-01):**
  - `users` — `user_id UUID PK`, `email TEXT UNIQUE NOT NULL`, `password_hash TEXT NOT NULL`, `created_at TIMESTAMPTZ`
  - `harness_members` — `user_id UUID FK → users`, `harness_id UUID FK → harnesses`, composite PK

  **Core tables — include explicit columns:**
  - `harnesses` — `harness_id`, `name`, `config JSONB`, `created_at`, `updated_at`
  - `runs` — `run_id`, `harness_id FK`, `temporal_workflow_id`, `status` (RUNNING/WAITING_FOR_HUMAN/STALLED/COMPLETED/FAILED), `current_phase` (TRIGGER/ACQUIRE/PLAN/EXECUTE/SHIP), `pipeline_position INT`, `pipeline_artifact JSONB`, `failure_reason`, `failure_detail`, `started_at`, `completed_at`, `updated_at`
  - `phase_artifacts` — `artifact_id`, `run_id FK`, `phase`, `artifact_type`, `content JSONB`, `version INT`, `created_at`
  - `gate_events` — `gate_id`, `run_id FK`, `harness_id FK`, `phase`, `agent_id`, `pipeline_position INT NOT NULL`, `fired_at`, `gap_description`, `question`, `source JSONB`, `snapshot JSONB NOT NULL`, `temporal_workflow_id`, `timeout_ms BIGINT`, `resolved_at`, `resolution JSONB`
  - `audit_events` — `event_id`, `run_id`, `harness_id`, `phase`, `event_type`, `actor JSONB`, `payload JSONB`, `created_at` (immutability enforced via raw SQL `CREATE RULE` in migration — not Prisma schema)
  - `connectors` — `connector_id`, `harness_id FK`, `connector_type`, `category`, `config_encrypted TEXT`, `is_active BOOL`, `created_at`
  - `agent_configs` — `agent_config_id`, `harness_id FK`, `phase`, `position INT`, `agent_id`, `llm_connector_id`, `model`, `max_tokens INT`, `system_prompt_body TEXT`, `skills JSONB`, `rules JSONB`, `is_active BOOL`
  - `skills` — `skill_id`, `harness_id FK`, `name`, `description`, `applicable_phases TEXT[]`, `content TEXT`, `version INT`, `is_active BOOL`, `created_at`
  - `rules` — `rule_id`, `harness_id FK`, `name`, `applicable_phases TEXT[]`, `constraint_text TEXT`, `enforcement TEXT` (hard/soft), `pattern_type TEXT` (path/regex/semantic), `patterns TEXT[]`, `is_active BOOL`, `created_at`
  - `memory_records` — `memory_id`, `harness_id FK`, `type memory_type`, `content TEXT`, `embedding VECTOR(1536)`, `source_run_id`, `relevance_tags TEXT[]`, `content_hash TEXT`, `created_at`, `updated_at`, UNIQUE(`harness_id`, `content_hash`)
  - `memory_staging` — `staging_id`, `run_id FK`, `harness_id FK`, `type memory_type`, `content TEXT`, `embedding VECTOR(1536)`, `relevance_tags TEXT[]`, `content_hash TEXT`, `created_at`
  - `memory_type` enum — `TaskPattern`, `FileConvention`, `TeamConvention`, `GatePattern`, `RiskSignal`, `RepoMap`

- [ ] **W1-07** — Run `pnpm --filter api prisma migrate dev --name init` against the running `finch-postgres` container. The migration must:
  1. Begin with `CREATE EXTENSION IF NOT EXISTS vector;` before any table definitions — this is required for `VECTOR` columns and will fail silently if omitted
  2. Create all tables from W1-06
  3. Add `CREATE RULE no_audit_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;` and `CREATE RULE no_audit_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;` as raw SQL after creating `audit_events`
  4. Add indexes: `HNSW` index on `memory_records.embedding` with `vector_cosine_ops`, and the indexes on `runs`, `gate_events`, `audit_events` from `docs/SDD.md` section 15.1
  Verify: migration applies with zero errors. Commit the generated migration file.

- [ ] **W1-08** — Configure Pino as the NestJS logger adapter in `apps/api/src/main.ts`. Every log line must include `service: finch-api`. Log level read from `LOG_LEVEL` environment variable, defaulting to `info`.

- [ ] **W1-09** — Add `GET /health` endpoint in `ApiModule`. Returns `{ status: "ok", service: "finch-api", timestamp: <ISO string> }`. Verify: `curl http://localhost:3001/health` returns HTTP 200 with that body.

- [ ] **W1-10** — Scaffold `apps/web` as a React 18 + Vite application with strict TypeScript. Install TanStack Router, TanStack Query, Radix UI. Single placeholder route at `/` rendering `<h1>Finch</h1>`. Verify: `pnpm --filter web dev` starts on port 3000 and the page loads.

- [ ] **W1-11** — Write a root `README.md` covering: what Finch is (2–3 sentences), prerequisites, how to start the stack, how to run the API, how to run the frontend, links to `AGENTS.md` and `docs/SDD.md`. Also create `skills/README.md` with the content describing the two skill files, when to read them, and the dual purpose (implementing agent guidance + runtime skill source material).

- [ ] **W1-12** — Configure GitHub Actions CI at `.github/workflows/ci.yml`. Five jobs, all triggered on every push and PR:
  1. **install** — `pnpm install`
  2. **typecheck-api** — `pnpm --filter api exec tsc --noEmit`
  3. **typecheck-web** — `pnpm --filter web exec tsc --noEmit`
  4. **unit-tests** — `pnpm --filter api test run`
  5. **integration-tests** — `pnpm --filter api test:integration` with services `postgres: pgvector/pgvector:pg16` and `redis: redis:7-alpine`. This job runs no tests in Wave 1 (they are added in W2-07) but the job must exist so integration tests run automatically when added.

**Wave 1 complete when all of the following pass:**
1. `docker compose -f infra/docker-compose.yml up -d` succeeds
2. `bash infra/healthcheck.sh` exits 0
3. `pnpm install` succeeds from repo root
4. `pnpm --filter api prisma migrate deploy` applies with zero errors
5. `pnpm --filter api dev` starts and `curl http://localhost:3001/health` returns 200
6. `pnpm --filter web dev` starts and the page loads on port 3000
7. `pnpm --filter api exec tsc --noEmit` produces zero errors
8. Temporal UI is reachable at `http://localhost:8080`

---

## Wave 2 — Persistence + Temporal Workflow

**Goal:** all repositories implemented and tested against the live database. `finchWorkflow` runs end-to-end through all five phases with stub activities and reaches COMPLETED in the Temporal UI.

- [ ] **W2-01** — Implement `PrismaService` in `PersistenceModule`. Injectable NestJS service. Initialises the Prisma client in `onModuleInit`, disconnects in `onModuleDestroy`.

- [ ] **W2-02** — Implement `RunRepository` with methods:
  - `create(data)` — creates a Run record
  - `findById(runId)` — returns Run or null
  - `findByHarnessId(harnessId, options?)` — paginated list
  - `updateStatus(runId, status)` — updates status field
  - `updatePhase(runId, phase)` — updates `current_phase` field
  - `updatePipelinePosition(runId, phase, position, artifact)` — writes `pipeline_position` and `pipeline_artifact` before each agent invocation. This is the crash recovery write — it must happen before agent invocation, not after (FF-09)
  - `getPipelineState(runId, phase)` — returns `{ pipelinePosition, pipelineArtifact }` or null
  - `getPersistedPipelineArtifact(runId: string, phase: Phase, position: number)` — returns the artifact written by `updatePipelinePosition` for the specific run, phase, and position. Used by `AgentDispatcherService.buildSnapshot()` to populate `agentOutputsBeforeGate`. Note: `position` alone is not unique — the signature must include `runId` and `phase` to avoid returning the wrong artifact for concurrent runs.
  - `markCompleted(runId)` — sets status COMPLETED and `completed_at`
  No `any` types.

- [ ] **W2-03** — Implement `GateRepository` with methods:
  - `create(gateEvent)` — persists gate event with typed snapshot
  - `findById(gateId)` — returns GateEvent or null
  - `findByRunId(runId)` — returns all gates for a run
  - `findOpenGateByThread({ channelId, threadTs })` — returns the open (unresolved) gate for a Slack thread, used by Slack connector for gate response routing
  - `saveResolution(gateId, resolution)` — persists the resolution and sets `resolved_at`
  - `markResolved(gateId)` — sets `resolved_at` to now

- [ ] **W2-04** — Implement `ArtifactRepository` with methods:
  - `save({ runId, phase, artifactType, content, version })` — stores artifact as JSONB
  - `findByRunIdAndPhase(runId, phase)` — returns latest artifact for that phase

- [ ] **W2-05** — Implement `HarnessRepository` with methods:
  - `create(data)` — creates a Harness record
  - `findById(harnessId)` — returns Harness or null
  - `findAll()` — returns all harnesses
  - `update(harnessId, data)` — partial update

- [ ] **W2-06** — Write `apps/api/prisma/seed.ts`. Creates:
  1. A default user: `email: admin@finch.local`, `password_hash`: bcrypt hash of `finch-dev-password`
  2. A default Harness record: `name: "default"`
  3. The default user added to the default harness via `harness_members`
  4. One default `AgentConfig` record per phase (TRIGGER, ACQUIRE, PLAN, EXECUTE, SHIP) for the default harness, `position: 0`, `model: "claude-sonnet-4-5"`, empty `system_prompt_body`
  Run: `pnpm --filter api prisma db seed`. Verify: all records appear in the database.

- [ ] **W2-07** — Write Vitest integration tests for all four repositories in `apps/api/tests/integration/`. Tests must run against the real Postgres container — no mocks. Each test: creates a record, reads it back, updates it, verifies the update. Include a test for `getPersistedPipelineArtifact` that writes via `updatePipelinePosition` then reads back with the correct `(runId, phase, position)` signature to confirm it returns the right artifact. Verify: `pnpm --filter api test:integration` passes.

- [ ] **W2-08** — Implement `TemporalWorkerService` in `WorkflowModule`. Connects to Temporal at `TEMPORAL_ADDRESS`. Registers stub activities (see W2-11). **`worker.run()` must not be awaited inside `onModuleInit`** — use a detached promise with a crash handler: `worker.run().catch(err => { logger.error(err); process.exit(1); })`. See `skills/nestjs-patterns.md` section "Temporal worker lifetime inside NestJS".

- [ ] **W2-09** — Add a `WorkflowClient` custom provider to `WorkflowModule` and export it:
  ```typescript
  { provide: WorkflowClient, useFactory: () => new WorkflowClient({ address: process.env.TEMPORAL_ADDRESS }) }
  ```
  `GateControllerService` and other services inject it via constructor injection. They must not call `new WorkflowClient()` directly. See `skills/nestjs-patterns.md` section "Injecting the Temporal WorkflowClient".

- [ ] **W2-10** — Implement `finchWorkflow` in `apps/api/src/workflow/finch.workflow.ts`. Must implement: all five phases in sequence, gate signal handling (`gateResolvedSignal`, `stopRunSignal` registered before the first `await`), backward traversal routing in PLAN and EXECUTE gate loops, multi-repo Ship fan-out with `Promise.all` over parallel `runShipPhase` activities. The workflow must be deterministic — no `Date.now()`, no `Math.random()`, no I/O, no service calls. Additionally: the workflow must call `logTraversalEvent` on every backward traversal — this activity is idempotent via `gateId` deduplication and must be called as a non-retryable activity. See `skills/temporal-patterns.md` sections "The fundamental rule", "Signals", "Parallel activities with Promise.all", and "Audit activities from inside the workflow".

- [ ] **W2-11** — Implement stub activities for all entries in the `FinchActivities` interface. Each stub must return a minimal valid typed artifact. Full list:
  - `runTriggerPhase` — returns minimal `TaskDescriptor`
  - `runAcquirePhase` — returns minimal `ContextObject` with `hasGap: false`
  - `resumeAcquirePhase` — returns minimal `ContextObject` with `hasGap: false`
  - `runPlanPhase` — returns minimal `PlanArtifact` with `hasGap: false`
  - `resumePlanPhase` — returns minimal `PlanArtifact` with `hasGap: false`
  - `runExecutePhase` — returns minimal `VerificationReport` with `hasGap: false`, `allPassing: true`
  - `resumeExecutePhase` — returns minimal `VerificationReport` with `hasGap: false`, `allPassing: true`
  - `runShipPhase` — returns minimal `ShipResult`
  - `aggregateShipResults` — sets run status to COMPLETED, logs `ship_completed` per repo (no-op stub for now)
  - `getRegisteredRepos` — returns `[{ repoId: 'stub-repo' }]`
  - `mergeRunMemory` — no-op stub
  - `markRunCompleted` — updates run status to COMPLETED in Postgres
  - `logTraversalEvent` — no-op stub (idempotent implementation comes in W3-14)
  All stubs must be registered in `TemporalWorkerService`.

- [ ] **W2-12** — Implement `GET /api/runs/:runId` in `RunsController`. Returns the Run record from Postgres.

- [ ] **W2-13** — End-to-end verification. Using the Temporal client directly (or a temporary test script): start `finchWorkflow` with a stub `RawTriggerInput`. Verify it appears in Temporal UI at `http://localhost:8080`, traverses all five phases via stub activities, and shows status COMPLETED. Verify `GET /api/runs/:runId` returns status COMPLETED from Postgres.

**Wave 2 complete when:** `finchWorkflow` starts, traverses all five phases with stub activities, and reaches COMPLETED in both Temporal UI and Postgres.

---

## Wave 3 — Agent Layer + Minimal Webhook

**Goal:** all five phase agents running real LLM loops. Gates fire and resolve correctly. The full gate cycle (fire → question logged → resolve via API → resume → complete) is testable end-to-end using the Webhook trigger and the gate respond endpoint — no Slack required.

- [ ] **W3-01** — Implement `LLMRegistryService` in `LLMModule`. Manages Anthropic and OpenAI provider instances. Reads `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from environment via `ConfigService`.

- [ ] **W3-02** — Implement `AnthropicConnectorService` implementing `LLMConnector`. Wraps `@anthropic-ai/sdk`. Maps `LLMCompleteParams` to Anthropic API params and response to `LLMResponse`. Registers itself in `LLMRegistryService` on `onModuleInit`.

- [ ] **W3-03** — Implement `OpenAIConnectorService` implementing `LLMConnector`. Wraps `openai` SDK. Used for embeddings (`text-embedding-3-small`) in Wave 5. Registers itself on `onModuleInit`.

- [ ] **W3-04** — Implement `BaseAgent<TInput, TOutput>` abstract class in `AgentModule`. Builds system prompt from locked preamble + user body + skills content + rules content. Runs the agentic loop: messages array, `llm.complete()`, tool call routing. When `fire_gate` tool is called, `runAgentLoop()` must **return** a `new GateEvent(...)` instance — it must not throw an exception. The dispatcher uses `result instanceof GateEvent` to distinguish a gate from a completed artifact. If an exception is thrown instead, no gate will ever fire. Logs `llm_call` and `tool_call` audit events on every iteration.

- [ ] **W3-05** — Implement the locked gate condition preamble as a protected string constant assembled in `AgentDispatcherService` and prepended to every agent's system prompt at invocation time. It must not be stored in the database. It must not appear in any API response as an editable field. It must not be accepted as user input in any request body. Also implement `LockedPreambleGuard` as a NestJS `CanActivate` guard that rejects `systemPromptBody` values containing gate condition language patterns (regex patterns matching "fire gate", "clarification gate", "context gap", "gate condition"). Apply `LockedPreambleGuard` to `PATCH /api/agents/:harnessId/:phase`. Per FC-09 and FF-08.

- [ ] **W3-06** — Implement `AgentConfigService` in `AgentModule`. Must expose:
  - `getPipeline(phase: Phase, harnessId: string): Promise<AgentPipelineConfig>` — reads from `agent_configs` table via Prisma, returns agents ordered by `position` ascending as a typed `AgentPipelineConfig`. This method is called by `AgentDispatcherService` before every phase execution.

- [ ] **W3-07** — Implement `AgentDispatcherService` in `OrchestratorModule`. Read `skills/nestjs-patterns.md` before implementing (circular dependency risk). Must implement:
  - Calls `AgentConfigService.getPipeline()` to get the ordered agent list
  - Calls `runRepository.getPipelineState()` on entry for crash recovery fast-forward
  - Writes `pipeline_position` and `pipeline_artifact` via `runRepository.updatePipelinePosition()` **before** each agent invocation (FF-09)
  - On gate resume: reads prior outputs from `resumeFromSnapshot.agentOutputsBeforeGate` — not from `pipelineArtifact` (FF-10)
  - On crash recovery (no snapshot): reads from `persisted.pipelineArtifact`
  - Emits `agent_skipped_on_resume` audit event for each skipped agent (FF-05)
  - Hard rule check via `RuleEnforcementService.checkHardRules()` before each agent — passes `currentArtifact` at check time (AR-07)
  - Soft rule check via `RuleEnforcementService.checkSoftRules()` after each agent — passes `currentArtifact` at check time (AR-07)
  - `buildSnapshot()` calls `runRepository.getPersistedPipelineArtifact(runId, phase, position)` for each prior position to populate `agentOutputsBeforeGate`
  - When dispatcher fires a gate due to hard rule violation: `GateEvent.agentId = step.agentId`, audit actor = `{ type: 'orchestrator', triggeredBy: 'rule_enforcement', agentId: step.agentId }` (AR-08)
  See `docs/SDD.md` `AgentDispatcherService` class and AGENTS.md section 9.

- [ ] **W3-08** — Implement `RuleEnforcementService`. Path and regex pattern types use deterministic evaluation — no LLM call. Semantic pattern type uses `claude-haiku-4-5` with max 50 tokens. For semantic evaluation: the `currentArtifact` at check time must be passed in and included in the LLM prompt alongside the action description string (AR-07). Hard rule violations return `{ violated: true, rule, gateQuestion }`. Soft rule violations log `rule_deviation` audit events and do not block execution.

- [ ] **W3-09** — Create `src/audit/audit-event-types.ts` with the `REQUIRED_AUDIT_EVENT_TYPES` constant containing every event type from AU-03 in RULES.md, explicitly including `agent_skipped_on_resume`. Create `tests/unit/audit-coverage.test.ts` that scans all `.ts` source files and fails if any event type in `REQUIRED_AUDIT_EVENT_TYPES` has no emit site of the form `eventType: '<type>'`. This test must pass before Wave 3 is considered complete (AU-01).

- [ ] **W3-10** — Implement `AuditLoggerService` in `AuditModule`. Critical events (from AU-03 in RULES.md) written synchronously to Postgres before any downstream action. Non-critical events enqueued via BullMQ to the `audit-write` queue. All events published to Redis pub/sub channel `audit-events:{harnessId}` immediately after the synchronous/enqueue decision. Implement `AuditWriteProcessor` as a BullMQ processor on the `audit-write` queue that reads each job and writes the event to Postgres. Without this processor, non-critical events are enqueued and never persisted.

- [ ] **W3-11** — Implement `TriggerAgentService.runPhase()`. Takes `RawTriggerInput`, returns `TaskDescriptor`. Strips `@finch` prefix from `rawText` to produce `normalizedIntent`. No memory reads or writes. No gate. Emits `phase_started` and `phase_completed` audit events. Per FC-01 and FF-01.

- [ ] **W3-12** — Implement `AcquireAgentService.runPhase()` and `resumePhase()`. `runPhase` must call `MemoryConnectorService.query()` as its first operation before any external connector (ME-01, FF-08). Emits `phase_started` and `phase_completed` audit events. If dispatcher returns `GateEvent`, calls `GateControllerService.dispatch()` and returns `ContextObject` with `hasGap: true`. `resumePhase` enriches the `ContextObject` with the resolution and re-enters the dispatcher with `resumeFromSnapshot`.

- [ ] **W3-13** — Implement `PlanAgentService.runPhase()` and `resumePhase()`. Emits `phase_started` and `phase_completed` audit events. Gate P fires on context gap only — never for plan approval (FC-03, FF-03). `resumePhase` handles both same-phase resume and post-backward-traversal resume.

- [ ] **W3-14** — Implement `ExecuteAgentService`. Extends `BaseAgent`. Emits `phase_started` and `phase_completed` audit events. `buildLockedPreamble()` includes scope enforcement instructions, plan-as-contract constraint, and gate condition. `executeToolCall()` checks `github_write_file` target path against `scopeBoundaries.excludedPaths` before proceeding — violation throws `ScopeViolationError` (FF-04). Gate E fires on context gap — not on technical failures.

- [ ] **W3-15** — Implement `ShipAgentService.runPhase()`. No gate (FC-07, FF-06). Emits `phase_started` and `phase_completed` audit events. Writes memory update to staging via `MemoryConnectorService.writeToStaging()`. Does not call `mergeRecord()` directly (FF-07). The `aggregateShipResults` activity updates run status to COMPLETED and logs `ship_completed` / `ship_failed` per repo.

- [ ] **W3-16** — Implement `GateControllerService.dispatch()` and `resolve()` fully:
  - `dispatch()`: logs `gate_fired` (critical synchronous write — before anything else, per AU-03), then persists `GateEvent`, updates run to `WAITING_FOR_HUMAN`, posts question to trigger channel, schedules 48-hour BullMQ timeout job, logs `gate_question_sent`
  - `resolve()`: evaluates traversal direction (Gate A always ACQUIRE; Gate P/E uses `claude-haiku-4-5` to classify), persists resolution, cancels timeout job, updates run to RUNNING, signals Temporal workflow via injected `WorkflowClient`, logs `gate_resumed`
  See `docs/SDD.md` `GateControllerService` class.

- [ ] **W3-17** — Implement `MemoryConnectorService.query()` as a stub that returns an empty `MemoryHit[]` array. Emits a `memory_read` audit event on every call — even when returning empty results — so the AU-01 coverage test can verify the emit site exists and W3-21 step 2 can confirm the call was made.

- [ ] **W3-18** — Implement minimal `WebhookConnectorService`. Exposes `POST /api/trigger/:harnessId` — accepts JSON body with `rawText`, builds `RawTriggerInput` with a new `runId` (uuid), starts `finchWorkflow` via Temporal with `workflowId: finch-{runId}`, creates a Run record in Postgres. No HMAC validation yet (added in W4-02). Registers itself in `ConnectorRegistryService` on `onModuleInit`.

- [ ] **W3-19** — Implement `ConnectorRegistryService` in `ConnectorModule` with `register()`, `getTriggerConnector()`, `getAcquireConnectors()`, `getExecuteConnector()` per `docs/SDD.md` `ConnectorRegistryService` class.

- [ ] **W3-20** — Replace all stub activities from Wave 2 with real agent service method bindings in `TemporalWorkerService`. Also replace the `logTraversalEvent` stub with a real implementation that checks `auditRepository.findByGateIdAndEventType(gateId, 'gate_traversal_backward')` for deduplication before writing — see `skills/temporal-patterns.md` section "Audit activities from inside the workflow".

- [ ] **W3-21** — End-to-end gate cycle verification (no Slack required):
  1. `POST /api/trigger/default` with `{ "rawText": "fix the payments thing", "harnessId": "default", "runId": "<uuid>" }` — starts a run
  2. Verify a `memory_read` audit event appears in the log, confirming `MemoryConnectorService.query()` was called (even with empty results)
  3. Verify run status becomes `WAITING_FOR_HUMAN` in Postgres
  4. Verify a `gate_fired` audit event appears in the log before `gate_question_sent`
  5. `POST /api/gate/:gateId/respond` with `{ "answer": "The payments module is in src/payments" }` — resolves the gate
  6. Verify run status returns to RUNNING then reaches COMPLETED
  7. Note: with the default single-agent pipeline, `agent_skipped_on_resume` will not appear — this is correct. Verify instead that the gate snapshot's `pipelinePosition` field is `0` and no `agent_skipped_on_resume` events appear erroneously.

**Wave 3 complete when:** a vague task triggers Gate A via the Webhook connector, the gate resolves via `POST /api/gate/:id/respond`, and the run reaches COMPLETED in Temporal UI and Postgres with the correct audit trail.

---

## Wave 4 — Full Connectors + Real-time Layer

**Goal:** Slack trigger works end-to-end including gate question threading. GitHub connectors work. Jira fetches issue data. Socket.io pushes live run events. Webhook gets HMAC validation. `CredentialEncryptionService` is implemented.

- [ ] **W4-01** — Implement `CredentialEncryptionService` using Node.js `crypto`, AES-256-GCM. Methods: `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`. Key read from `ENCRYPTION_KEY` env var (must be 64 hex chars = 32 bytes). Used by all connector services when storing and reading credentials. Per CO-03 in RULES.md.

- [ ] **W4-02** — Add HMAC-SHA256 validation to `WebhookConnectorService`. Validate `X-Finch-Signature` header against the request body using `WEBHOOK_SECRET` env var. Reject unsigned or incorrectly signed requests with 401.

- [ ] **W4-03** — Implement `SlackConnectorService` using `@slack/bolt`. Message filtering rules:
  - Ignore messages where `event.subtype` is set (bot messages, file uploads, join/leave notifications)
  - Only process messages where `event.text` starts with the configured `TRIGGER_PREFIX` (default: `@finch`)
  - For threaded messages: check `thread_ts` against `GateRepository.findOpenGateByThread()` — if a match exists, call `GateControllerService.resolve()` and return without starting a new workflow
  - For non-threaded messages passing the prefix filter: build `RawTriggerInput` and start `finchWorkflow`
  Posts gate questions and Ship notifications as Slack thread replies. Registers itself in `ConnectorRegistryService` on `onModuleInit`. See `docs/SDD.md` `SlackConnectorService` class.

- [ ] **W4-04** — Implement `GitHubAcquireConnectorService` using `@octokit/rest`. Fetches repo metadata, file tree, package manifests, and import graphs for paths relevant to the task. Used by `AcquireAgent` for repo map construction in multi-repo harnesses.

- [ ] **W4-05** — Implement `GitHubExecuteConnectorService`. Clones repo to ephemeral workspace via `simple-git`. Creates feature branch `finch/{planId}`. Applies file edits using these rules:
  - Use `ts-morph` for structural edits to `.ts`/`.tsx` files (adding imports, modifying function signatures, inserting class members)
  - Use direct file write for all other cases: `.js` files where the change is a full replacement, JSON/YAML/config files, or any non-TypeScript file
  Runs verification commands via `spawn`. `runCommand()` emits `verification_run` and `verification_result` audit events. Cleans up ephemeral workspace in a `finally` block regardless of outcome (CQ-05). See `docs/SDD.md` `GitHubExecuteConnectorService` class.

- [ ] **W4-06** — Implement `GitHubShipConnectorService` using `@octokit/rest`. Opens PR with generated title and body. PR body includes: task link, plan summary, modified files, verification results, `run_id`. In multi-repo runs each PR cross-references sibling PRs in its body.

- [ ] **W4-07** — Implement `JiraConnectorService` using `jira.js`. Given a Jira issue key extracted from the task descriptor, fetches: summary, description, acceptance criteria, issue type, priority, labels, components, sprint, epic, linked issues, subtasks, comments, assignee, reporter.

- [ ] **W4-08** — Implement `GateTimeoutProcessor` as a BullMQ processor on the `gate-timeout` queue. On timeout: sets run to STALLED, re-sends gate question to trigger channel, schedules a 24-hour retry job. Must be idempotent — check `gate.resolvedAt` at the start and return early if already resolved. See `docs/SDD.md` `GateTimeoutProcessor` class.

- [ ] **W4-09** — Implement `RunGateway` Socket.io WebSocket gateway in `WebSocketModule`. Uses Redis adapter. Rooms scoped by `harness:{harnessId}`. Verifies JWT on connection — disconnect unauthenticated clients. `join_harness` message handler checks harness membership before joining the room. See `docs/SDD.md` `RunGateway` class.

- [ ] **W4-10** — Wire `AuditLoggerService` to publish all events to Redis pub/sub channel `audit-events:{harnessId}` on every write. `RunGateway` subscribes via Redis adapter and emits `run.event` to the correct `harness:{harnessId}` room. See `docs/SDD.md` `AuditLoggerService` publishing section.

- [ ] **W4-11** — End-to-end verification: `POST /api/trigger/default` starts a run. A `wscat` client connected to the Socket.io gateway and joined to `harness:default` receives `run.event` messages for each phase transition in real time. GitHub Ship creates a real PR on a test repository.

**Wave 4 complete when:** Slack trigger starts a run, Socket.io delivers live phase transition events to connected clients, and GitHub Ship opens a real PR.

---

## Wave 5 — Multi-repo Support + Memory System

**Goal:** multiple registered repositories work end-to-end. The full memory system operates: embeddings generated, records stored, semantic query works, staging merges at Ship. Memory persists across runs and influences subsequent Acquire phases.

- [ ] **W5-01** — Implement `EmbeddingService` in `MemoryModule`. Wraps OpenAI `text-embedding-3-small` via `OpenAIConnectorService`. Returns a 1536-dimension `number[]` for any input string.

- [ ] **W5-02** — Implement `MemoryConnectorService` fully, replacing the W3-17 stub:
  - `query(params)` — generates query embedding via `EmbeddingService`, runs pgvector cosine similarity search with minimum relevance score 0.7, returns `MemoryHit[]` ordered by relevance. Emits `memory_read` audit event with the hit count in the payload.
  - `writeToStaging(params)` — generates embedding, computes SHA-256 content hash, writes to `memory_staging`. Emits `memory_staged` audit event.
  - `mergeRecord(record)` — `ON CONFLICT (harness_id, content_hash) DO UPDATE` upsert into `memory_records` (ME-02). Raw SQL permitted here.
  - `getStagingRecords(runId)` — returns all staging records for a run
  - `clearStaging(runId)` — deletes all staging records for a run (ME-03)
  See `docs/SDD.md` `MemoryConnectorService` class.

- [ ] **W5-03** — Implement `MemoryActivities.mergeRunMemory()` as a real Temporal activity replacing the W2-11 stub. Calls `getStagingRecords()`, iterates calling `mergeRecord()` for each, calls `clearStaging()`, emits `memory_merged` audit event. Idempotent: if staging is already empty, return cleanly. After implementing: update the `mergeRunMemory` binding in `TemporalWorkerService` to point to the real `MemoryActivities.mergeRunMemory` method — the stub binding from W2-11 must be replaced.

- [ ] **W5-04** — Implement `aggregateShipResults` as a real activity replacing the W2-11 stub. Sets run status to COMPLETED. Logs `ship_completed` for successful repos and `ship_failed` for failed repos. Update the binding in `TemporalWorkerService`.

- [ ] **W5-05** — Wire real embeddings into `AcquireAgentService.runPhase()`. Memory query now uses the real `MemoryConnectorService.query()` from W5-02. Verify: running a task similar to a prior completed run returns relevant memory hits in the `memory_read` audit event payload.

- [ ] **W5-06** — Implement multi-repo support in `AcquireAgent`. When two or more repositories are registered in harness config, build a `repoMap` as part of `ContextObject` assigning components and paths to repos via `GitHubAcquireConnectorService`. If `AcquireAgent` cannot confidently assign a component, the `repoRouting` dimension is rated `insufficient` and Gate A fires.

- [ ] **W5-07** — Implement multi-repo support in `PlanAgent`. Every sub-task in `PlanArtifact` must carry a `repoId` derived from the `repoMap`. A plan with any unassigned sub-task is invalid — the agent must re-plan or fire Gate P.

- [ ] **W5-08** — Implement multi-repo Ship fan-out. When `getRegisteredRepos()` returns more than one repo, `finchWorkflow` fans out to parallel `runShipPhase` activities using `Promise.all`. Each activity handles exactly one repo. `mergeRunMemory` is called after all Ship activities resolve. `aggregateShipResults` is called with all outcomes. See `skills/temporal-patterns.md` section "Parallel activities with Promise.all".

- [ ] **W5-09** — Add `GET /api/memory` endpoint. Accepts query params: `harnessId`, `q` (semantic search string), `type`, `limit`, `cursor`. Returns paginated `MemoryHit[]` ordered by relevance score.

- [ ] **W5-10** — Verify memory persistence across runs:
  1. Trigger and complete a first run against a known domain (e.g. "implement the payments feature")
  2. Trigger a second run with a related task against the same domain
  3. Verify the second run's `memory_read` audit event has a non-empty `hits` payload with at least one hit with `relevanceScore >= 0.7` from the first run's data
  4. Verify memory staging records from run 1 are absent after merge (cleared by `clearStaging`)

**Wave 5 complete when:** multi-repo runs create PRs in each registered repository, and memory hits from prior runs appear in subsequent Acquire phases with `relevanceScore >= 0.7`.

---

## Wave 6 — Frontend + Observability

**Goal:** the Finch web UI displays live run state, humans can respond to gates, Prometheus metrics are scraped by Grafana, and Playwright e2e tests pass.

- [ ] **W6-01** — Implement JWT authentication. `POST /api/auth/login` accepts `{ email, password }`, validates against the `users` table (using the seeded `admin@finch.local` user from W2-06), returns access token in `httpOnly` cookie (15-minute expiry). `POST /api/auth/refresh` rotates refresh token (7-day expiry with rotation). `HarnessAuthGuard` uses `user.harnessAccess` populated from `harness_members` join. `AuthService` and `JwtStrategy` per `docs/SDD.md` security section.

- [ ] **W6-02** — Implement run list page at `/runs`. Shows all runs for the default harness with status badge, current phase, and start time. Uses TanStack Query to fetch `GET /api/runs?harnessId=default`. Auto-refreshes every 5 seconds.

- [ ] **W6-03** — Implement run detail page at `/runs/:runId`. Shows all five phases in a timeline. The timeline must render phases in the canonical TAPES order (TRIGGER → ACQUIRE → PLAN → EXECUTE → SHIP) regardless of audit event timestamp order — use a hardcoded phase order array to sort phase headers, not event timestamps. TRIGGER must always appear first. Uses the `useRunStream` Socket.io hook for live updates.

- [ ] **W6-04** — Implement audit timeline at `/runs/:runId/audit`. Chronological list of all audit events for the run. Uses `@tanstack/virtual` for virtualised rendering at scale. Filterable by event type.

- [ ] **W6-05** — Implement gate response panel component. Renders only when `run.status === 'WAITING_FOR_HUMAN'` (UI-03). Shows gap description, gate question, and a text input + submit button. Submit calls `POST /api/gate/:gateId/respond`. The locked preamble must not appear anywhere in the UI as an editable field (UI-01).

- [ ] **W6-06** — Implement memory browser page at `/memory`. Shows all memory records for the default harness via `GET /api/memory`. Supports semantic search. Shows `type`, `content`, `relevanceTags`, and source run for each record. Supports manual record creation and deletion.

- [ ] **W6-07** — Implement agent pipeline configuration page at `/agents/:harnessId`. Per-phase agent list. For each agent: locked preamble displayed as read-only block with label "Framework-owned (read-only)" (UI-01), Monaco Editor for editable `systemPromptBody`, model selector dropdown, skills and rules lists.

- [ ] **W6-08** — Implement connector configuration page at `/connectors/:harnessId`. Lists active connectors. Supports adding credentials — credentials stored encrypted at rest via `CredentialEncryptionService` (CO-03, implemented in W4-01). Shows connector health status. Repository registration for multi-repo harnesses.

- [ ] **W6-09** — Add OpenTelemetry instrumentation to `apps/api`. Expose Prometheus metrics at `GET /metrics` on port 9464. Implement custom Finch metrics:
  - `finch_gate_fires_total` — counter, labels: `phase`, `trigger_type`, `harness_id`
  - `finch_llm_tokens_total` — counter, labels: `agent_id`, `model`, `harness_id`
  - `finch_phase_duration_seconds` — histogram, labels: `phase`, `harness_id`
  - `finch_rule_violations_total` — counter, labels: `rule_type`, `enforcement`, `harness_id`
  - `finch_memory_query_ms` — histogram, labels: `harness_id`
  Note: do NOT implement `finch_pipeline_position` as an observable gauge — an observable gauge requires a database query on every Prometheus scrape which causes performance problems. Omit it or replace with `finch_pipeline_position_advances_total` counter.

- [ ] **W6-10** — Add Grafana service to `infra/docker-compose.yml`. Pre-configure the three dashboards from `docs/SDD.md` section 22.3: **Finch Operations**, **Finch Cost**, **Finch Trust**. Grafana scrapes Prometheus at `http://finch-api:9464/metrics`.

- [ ] **W6-11** — Implement analytics endpoint `GET /api/analytics/:harnessId`. Returns:
  - Gate frequency by phase (count of `gate_fired` events grouped by phase)
  - Gate frequency trend over time (last 30 runs, gate count per run)
  - Average gate resolution time (mean of `gate_resumed.createdAt - gate_fired.createdAt`)
  - Run completion rate (COMPLETED / total runs)
  - LLM cost estimate by agent (from `llm_call` audit events with token counts)

- [ ] **W6-12** — Implement analytics page at `/analytics/:harnessId`. Consumes `GET /api/analytics/:harnessId`. Uses Recharts for the gate frequency trend line chart. Shows completion rate, average resolution time, and per-agent LLM usage.

- [ ] **W6-13** — Write Playwright e2e tests in `tests/e2e/run-detail.spec.ts`. Must cover all four of:
  1. TRIGGER phase appears as the first entry in the run timeline
  2. Gate response panel submits and run transitions from `WAITING_FOR_HUMAN` to `RUNNING`
  3. `agent_skipped_on_resume` appears in the audit timeline when a gate fires at pipeline position > 0 (requires a two-agent pipeline configured for the test)
  4. Configure a hard path rule for `/src/auth`, trigger a task that touches auth, verify the gate fires and the rule's constraint text is visible in the gate question — this tests RU-02 from the PRD
  See test structure in `docs/SDD.md` e2e test section. Plan view must not contain an "approve" or "reject" button (UI-02).

- [ ] **W6-14** — Final end-to-end verification: trigger a complete run via Slack. Watch all five phases progress in the Finch UI in real time via Socket.io. Respond to a gate question through the gate response panel. Observe the run reach COMPLETED. Confirm `finch_gate_fires_total` and `finch_phase_duration_seconds` appear in Grafana. Confirm the analytics page shows the completed run.

**Wave 6 complete when:** all Playwright e2e tests pass and a complete run is observable end-to-end in the Finch UI with metrics visible in Grafana.

---

## Blocked Tasks

If a task is blocked after 3 fix attempts, move it here with: task ID, exact error message, what was tried, and what information is needed to unblock. Then move to the next independent task.

_(none yet)_