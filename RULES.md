# Finch — Implementation Rules

Rules are grouped by concern. Each rule has an enforcement level:

- **HARD** — violating this is a defect. No exceptions. No pragmatic shortcuts.
- **SOFT** — deviating is allowed if you document why in the commit message or PR description.

---

## Framework Fidelity (all HARD)

These map directly to the FC and IC constraints in `AGENTS.md`. Written as testable rules.

**FF-01** `HARD` — The Trigger phase must not write to `memory_staging`, `memory_records`, or any other persistence table except creating the Run record and emitting audit events.

**FF-02** `HARD` — The condition that causes a gate to fire must be identical across Gate A, Gate P, and Gate E: the agent self-identifies a context gap it cannot resolve from available sources. No gate may have a distinct trigger condition.

**FF-03** `HARD` — There must be no `WAITING_FOR_PLAN_APPROVAL` status, no plan approval API endpoint, no "approve plan" UI element, and no channel notification sent after the PlanArtifact is produced.

**FF-04** `HARD` — Before any file write in the Execute phase, the target path must be checked against `scopeBoundaries.excludedPaths`. A match must fire Gate E. The file must not be skipped silently or the write attempted anyway.

**FF-05** `HARD` — On gate resume, agents at positions 0 through N-1 (where N is the gate's `pipelinePosition`) must not be re-invoked. Their outputs must be restored from the typed gate snapshot. Each skipped agent must emit an `agent_skipped_on_resume` audit event.

**FF-06** `HARD` — The Ship phase must contain no `fire_gate` call, no gate-related tool, and no path that sets run status to `WAITING_FOR_HUMAN`.

**FF-07** `HARD` — `MemoryConnectorService.mergeRecord()` may only be called from `MemoryActivities.mergeRunMemory()`. No agent class, connector service, repository, or controller may call it directly. The permitted call site is exactly one.

**FF-08** `HARD` — The locked preamble string must not be stored in any database column, must not be returned in any API response as an editable field, and must not be accepted as input in any `PATCH` or `POST` request body.

**FF-09** `HARD` — `AgentDispatcherService` must call `runRepository.updatePipelinePosition()` with the current position and current artifact *before* invoking each agent — not after. This is the crash recovery write.

**FF-10** `HARD` — Gate resume and crash recovery use different artifact sources and must not be conflated. On gate resume, prior agent outputs are read from `resumeFromSnapshot.agentOutputsBeforeGate` (per-position, typed). On crash recovery (no snapshot), the last completed artifact is read from `persisted.pipelineArtifact` (single value, last written). Using `pipelineArtifact` to restore per-position outputs on a gate resume, or using the snapshot for crash recovery when no gate has fired, is a defect.

**FF-11** `HARD` — On gate resume, the Temporal workflow must route to the phase indicated by `resolution.requiresPhase`. It must not always resume in the phase where the gate fired.

---

## Architecture (all HARD)

**AR-01** `HARD` — Do not introduce circular module imports. If a circular dependency appears, restructure: extract a shared interface or move the dependency to a higher-level module.

**AR-02** `HARD` — `PersistenceModule` and `AuditModule` must not import any other application module. They are leaf dependencies.

**AR-03** `HARD` — Agents must not call other agents directly. All inter-agent communication goes through the canonical phase artifact passed by `AgentDispatcherService`.

**AR-04** `HARD` — The Temporal workflow function (`finch.workflow.ts`) must be deterministic. No `Date.now()`, no `Math.random()`, no direct I/O, no NestJS service calls. All side effects go in Activities.

**AR-05** `HARD` — Do not use any ORM other than Prisma. Do not write raw SQL except in `MemoryConnectorService` for the pgvector cosine similarity query and the `mergeRecord` upsert (where Prisma cannot express the query).

**AR-06** `HARD` — Do not use any workflow engine other than Temporal. Do not implement run state management, pause/resume, or crash recovery outside of Temporal.

**AR-07** `HARD` — When `RuleEnforcementService.evaluate()` is called with `patternType: 'semantic'`, the `currentArtifact` at rule-check time must be passed in and included in the LLM prompt alongside the action description string. Evaluating a semantic rule against only the description string, without the current artifact, is a defect.

**AR-08** `HARD` — When `AgentDispatcherService` fires a gate due to a hard rule violation (before agent invocation), `GateEvent.agentId` must be set to `step.agentId` — the agent that was about to be invoked. The corresponding audit event actor must be `{ type: 'orchestrator', triggeredBy: 'rule_enforcement', agentId: step.agentId }` to distinguish it from an agent-fired gate where the actor is `{ type: 'agent', agentId: step.agentId }`.

---

## Code Quality (all HARD)

**CQ-01** `HARD` — No `any` type. Use proper types from `packages/types`. If a type is missing, add it to `packages/types` — do not cast to `any`.

**CQ-02** `HARD` — TypeScript strict mode. All files must compile with `tsc --noEmit` producing zero errors before a task is marked done.

**CQ-03** `HARD` — No JavaScript files. All source files must be `.ts` or `.tsx`.

**CQ-04** `HARD` — Do not commit API keys, secrets, or credentials. Use environment variables. `.env` files must be in `.gitignore`.

**CQ-05** `HARD` — Every ephemeral Execute phase workspace (created via `tmp`) must be cleaned up in a `finally` block, regardless of whether execution succeeded or failed.

---

## Audit Log

**AU-01** `HARD` — Every event type in `REQUIRED_AUDIT_EVENT_TYPES` (`src/audit/audit-event-types.ts`) must have at least one emit site in the codebase. This includes `agent_skipped_on_resume`, which must be in the constant and must have an emit site in `AgentDispatcherService`. The Vitest test in `tests/unit/audit-coverage.test.ts` enforces this — do not delete or skip that test.

**AU-02** `HARD` — The `AuditLoggerService` must not expose an `update()` or `delete()` method. The audit log is append-only.

**AU-03** `HARD` — The following event types must be written to PostgreSQL synchronously (not via BullMQ queue) before any downstream action:
- Critical (synchronous): `gate_fired`, `gate_question_sent`, `phase_started`, `phase_completed`, `run_completed`, `run_failed`, `gate_traversal_backward`
- Non-critical (async BullMQ): all others, including `agent_skipped_on_resume`, `tool_call`, `llm_call`, `memory_staged`, `verification_run`, `verification_result`, `rule_deviation`, `skill_applied`, `artifact_handoff`, `agent_invoked`, `agent_completed`

---

## Observability (SOFT)

**OB-01** `SOFT` — Every Pino log line that runs inside a phase or agent invocation should include `runId`, `harnessId`, `phase`, `agentId`, and `pipelinePosition` where those values are available in scope.

**OB-02** `SOFT` — Each Prometheus counter/histogram increment should include `phase` and `harnessId` labels so dashboards can slice by these dimensions.

---

## UI Behaviour (HARD)

**UI-01** `HARD` — The locked preamble must be rendered as a read-only element with the label "Framework-owned (read-only)". It must not appear in any `<input>`, `<textarea>`, or Monaco Editor instance.

**UI-02** `HARD` — The run detail page must not contain any element that allows a human to approve or reject a plan. The plan view is observability only.

**UI-03** `HARD` — The gate response panel must only render when `run.status === 'WAITING_FOR_HUMAN'`. It must not render for any other run status.

---

## Memory (HARD)

**ME-01** `HARD` — `AcquireAgentService.runPhase()` must call `MemoryConnectorService.query()` as its first operation, before calling any external `AcquireConnector`.

**ME-02** `HARD` — Memory records must use `ON CONFLICT (harness_id, content_hash) DO UPDATE` — last write wins. Do not implement conflict detection, human review, or merge strategies.

**ME-03** `HARD` — Memory staging records for a run must be cleared (`clearStaging()`) after `mergeRunMemory` completes. Do not leave orphaned staging records.

---

## Connectors

**CO-01** `SOFT` — Connector failures (network errors, auth failures, rate limits) should be handled with exponential backoff retry before propagating. They must not trigger gate events.

**CO-02** `SOFT` — Every new connector must implement the relevant abstract interface from `docs/SDD.md` section 13.1 exactly. Do not add methods beyond the interface to the connector class itself — put them in private methods.

**CO-03** `SOFT` — Connector credentials must always be stored encrypted using `CredentialEncryptionService` (AES-256-GCM). Never store plaintext credentials in the database.

**CO-04** `HARD` — A connector error must never be caught and re-thrown as `GateRequiredError` or any error type that Temporal treats as non-retryable. Connector failures are operational — they are retried by Temporal's retry policy or by exponential backoff in the connector itself. Deciding to "ask the human" because a network call failed is a defect. The only valid source of a `GateRequiredError` is the agent's `fire_gate` tool call or the dispatcher's hard rule check.
