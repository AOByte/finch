# Finch — Agent Instructions

> Read this file in full before writing any code. Every section is load-bearing. For deep implementation detail, read the referenced source file or class — do not guess.

---

## 1. What is Finch?

Finch is a production-grade agentic harness for software development teams built on the TAPES framework (Trigger · Acquire · Plan · Execute · Ship). It receives tasks via configured trigger sources, acquires context, produces a plan, executes implementation work, and ships a deliverable — with structured human-in-the-loop checkpoints wherever the agent identifies a context gap.

**Finch is not a chatbot.** It is a phased orchestration engine with durable lifecycle semantics, persistent memory, a connector system, configurable per-phase agent pipelines, and a complete audit trail.

---

## 2. Naming

| Thing | Name |
|---|---|
| Product | `Finch` |
| Framework (conceptual only) | `TAPES` |
| Temporal task queue | `finch` |
| Temporal workflow function | `finchWorkflow` |
| Temporal activities type | `FinchActivities` |
| Workflow file | `finch.workflow.ts` |
| Workflow ID prefix | `finch-{runId}` |
| Slack trigger prefix | `@finch` |
| Docker services | `finch-api`, `finch-worker`, `finch-web`, `finch-postgres`, `finch-redis`, `finch-temporal`, `finch-temporal-ui` |
| Kubernetes namespace | `finch` |
| Prometheus metrics prefix | `finch_` |
| Database / user / password | `finch` |
| npm scope | `@finch/*` |

Use `TAPES` only when referring to the framework paper, phase names, gate names, or fidelity constraints.

---

## 3. Source of Truth

| Document | Path | Authority |
|---|---|---|
| Software Design Document | `docs/SDD.md` | Architecture, schemas, code patterns |
| Product Requirements | `docs/PRD.md` | What the product must do — overrides SDD |
| TAPES paper | `docs/TAPES-paper.md` | Framework semantics — overrides PRD |

When in doubt: **paper > PRD > SDD**.

---

## 4. Framework Fidelity Constraints

FC-01 through FC-09 derive from the TAPES paper and are inviolable. IC-01 derives from the SDD dispatcher design — it is an implementation constraint, not a paper constraint. Violations of IC-01 are SDD/PRD defects. See `RULES.md` for the full enforcement list.

| ID | Source | Constraint | Violation |
|---|---|---|---|
| FC-01 | Paper | Trigger is stateless — no memory writes, no gates, no state beyond TaskDescriptor | Gate or memory write in Trigger |
| FC-02 | Paper | All three gates fire under the identical condition: agent self-identifies an unresolvable context gap | Specialised gate trigger condition |
| FC-03 | Paper | Plan requires no human approval — no `WAITING_FOR_PLAN_APPROVAL` state, no approval UI | Any plan approval mechanism |
| FC-04 | Paper | Execute is strictly bounded by PlanArtifact — no silent scope expansion | Silent modification outside plan |
| FC-05 | Paper | Gates are pauses not restarts — prior agent outputs preserved and restored | Re-running agents before gate position |
| FC-06 | Paper | Backward traversal is permitted — Gate E may return to Plan, Gate P may return to Acquire | Blocking backward traversal |
| FC-07 | Paper | Ship has no gate — operational failures are retried and logged, never gated | Gate in Ship phase |
| FC-08 | Paper | Incremental trust — memory queried first in every Acquire phase | Skipping memory query at Acquire start |
| FC-09 | Paper | Locked preamble — gate condition injected by orchestration core, never user-editable | User-editable gate preamble |
| IC-01 | SDD | Resume is point-of-suspension — pipeline resumes from the firing agent, not position 0 | Resuming from position 0 on gate resume |

---

## 5. Technology Stack

Do not substitute any of these.

| Concern | Technology |
|---|---|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 20 LTS |
| Package manager | pnpm |
| Backend framework | NestJS 10 |
| Workflow engine | Temporal 1.24 (self-hosted) |
| ORM | Prisma |
| Database | PostgreSQL 16 + pgvector |
| Cache / Queue backend | Redis 7 + BullMQ |
| WebSocket | Socket.io + Redis adapter |
| LLM primary | Anthropic Claude (`@anthropic-ai/sdk`) |
| LLM embeddings | OpenAI `text-embedding-3-small` (`openai` SDK) |
| Slack | `@slack/bolt` |
| GitHub | `@octokit/rest` + `simple-git` |
| Jira | `jira.js` |
| AST editing | `ts-morph` |
| Frontend | React 18 + Vite |
| Routing | TanStack Router |
| Server state | TanStack Query |
| UI primitives | Radix UI |
| Styling | CSS Modules |
| Tests | Vitest + Supertest + Playwright |
| Logging | Pino |
| Metrics | OpenTelemetry + Prometheus |

---

## 6. Repository Structure

```
finch/
├── apps/
│   ├── api/src/
│   │   ├── orchestrator/     # GateControllerService, AgentDispatcherService, RuleEnforcementService
│   │   ├── workflow/         # finch.workflow.ts, TemporalWorkerService, finch.activities.ts
│   │   ├── agents/           # TriggerAgent, AcquireAgent, PlanAgent, ExecuteAgent, ShipAgent
│   │   ├── connectors/       # Slack, Webhook, Cron, Jira, GitHub×3
│   │   ├── llm/              # LLMRegistry, AnthropicConnector, OpenAIConnector
│   │   ├── memory/           # MemoryConnector, MemoryActivities, EmbeddingService
│   │   ├── audit/            # AuditLoggerService, audit-event-types.ts
│   │   ├── persistence/      # PrismaService, all repositories
│   │   ├── websocket/        # RunGateway
│   │   ├── auth/             # AuthService, JwtStrategy, guards
│   │   └── api/              # All controllers
│   │   prisma/               # schema.prisma, migrations/, seed.ts
│   └── web/src/
│       ├── routes/           # Dashboard, runs, memory, agents, connectors, rules, analytics
│       ├── components/       # RunStatusBadge, GateResponsePanel, AuditTimeline, AgentPipelineEditor…
│       ├── hooks/            # useRunStream, useGateResponse, useRunAudit
│       └── api/ lib/
├── packages/types/           # All shared TypeScript types and artifact schemas
├── infra/
│   ├── docker-compose.yml
│   └── healthcheck.sh
├── docs/                     # SDD.md, PRD.md, TAPES-paper.md
├── skills/                   # Skill modules — see skills/README.md
├── AGENTS.md                 # This file
├── RULES.md                  # All implementation rules with enforcement level
└── TASKS.md                  # Current wave task list
```

---

## 7. NestJS Module Tree

No circular imports. `PersistenceModule` and `AuditModule` are leaf dependencies.

```
AppModule
├── OrchestratorModule   (imports: AgentModule, ConnectorModule, MemoryModule, AuditModule, PersistenceModule, LLMModule)
├── WorkflowModule       (imports: AgentModule, MemoryModule, OrchestratorModule)
├── AgentModule          (imports: LLMModule, ConnectorModule, MemoryModule, AuditModule, PersistenceModule)
├── ConnectorModule      (imports: PersistenceModule)
├── LLMModule
├── MemoryModule         (imports: LLMModule, PersistenceModule, AuditModule)
├── AuditModule          (imports: PersistenceModule)
├── PersistenceModule
├── WebSocketModule      (imports: AuditModule)
├── AuthModule
└── ApiModule            (imports: all)
```

Full module declarations in `apps/api/src/*/`.module.ts files.

---

## 8. Phase Flow

```
RawTriggerInput (Slack / Webhook / Cron)
  → finchWorkflow starts
    → runTriggerPhase    → TaskDescriptor         [stateless, no gate]
    → runAcquirePhase    → ContextObject           [Gate A possible]
    → runPlanPhase       → PlanArtifact            [Gate P — context gap only, not approval]
    → runExecutePhase    → VerificationReport      [Gate E possible]
    → runShipPhase       → ShipResult              [no gate; parallel for multi-repo]
    → mergeRunMemory                               [orchestration layer — never called by agents]
    → markRunCompleted
```

Workflow code: `apps/api/src/workflow/finch.workflow.ts`
Agent implementations: `apps/api/src/agents/`

---

## 9. Key Implementation Contracts

The decisions most likely to go wrong silently. Read the referenced file before implementing each.

**Pipeline crash recovery** — `AgentDispatcherService` (`src/orchestrator/agent-dispatcher.service.ts`) writes `pipeline_position` and `pipeline_artifact` to the DB *before* invoking each agent via `runRepository.updatePipelinePosition(runId, phase, position, artifact)`. On Temporal replay after a crash, the dispatcher calls `runRepository.getPipelineState(runId, phase)` and fast-forwards past completed steps using the returned `pipelinePosition` and `pipelineArtifact`.

**`getPersistedPipelineArtifact` in buildSnapshot** — `AgentDispatcherService.buildSnapshot()` populates `agentOutputsBeforeGate` by calling `runRepository.getPersistedPipelineArtifact(position)` for each completed pipeline position before the gate. This method returns the artifact written by `updatePipelinePosition` for that specific position. It must exist on `RunRepository` with that exact signature. Without it, `buildSnapshot` cannot reconstruct prior agent outputs and the gate snapshot will be incomplete.

**Gate resume vs crash recovery — two distinct sources** — On gate resume, prior agent outputs are read from `resumeFromSnapshot.agentOutputsBeforeGate`. On crash recovery, the last completed artifact is read from `persisted.pipelineArtifact`. These are different sources serving different recovery paths. Do not conflate them. Gate resume has richer per-position data; crash recovery has only the last persisted artifact. See `src/orchestrator/agent-dispatcher.service.ts` for the full conditional logic.

**Gate snapshot** — built by `AgentDispatcherService` and attached to `GateEvent` before returning up the stack. The agent itself never builds a snapshot. Gate A/P/E snapshots have different typed shapes — `GateASnapshot`, `GatePSnapshot`, `GateESnapshot` — defined in `packages/types/gate.types.ts`.

**Memory merge ownership** — `mergeRunMemory` is a Temporal activity in `src/memory/memory.activities.ts` called by the *workflow* after all Ship activities complete. `ShipAgent` writes to memory staging only — it never calls merge. Any call to `MemoryConnectorService.mergeRecord()` outside of `MemoryActivities.mergeRunMemory()` is a defect.

**Locked preamble assembly** — assembled in `AgentDispatcherService` and prepended to the system prompt at invocation time. Never stored in the database. Never returned to the frontend as an editable field. See `src/orchestrator/agent-dispatcher.service.ts`.

**Slack gate routing** — on every incoming message, the Slack connector checks `thread_ts` against open gate events. Match → `GateControllerService.resolve()`. No match → new workflow. See `src/connectors/slack.connector.service.ts`.

**Audit log immutability** — enforced at the PostgreSQL layer via `CREATE RULE no_audit_update` and `CREATE RULE no_audit_delete`. `AuditLoggerService` exposes no mutation methods. See `src/audit/audit-logger.service.ts`.

**Dispatcher-fired gate `agentId` convention** — when `AgentDispatcherService` fires a gate due to a hard rule violation (before agent invocation), `GateEvent.agentId` is set to `step.agentId` — the agent that was about to be invoked. The audit event actor is `{ type: 'orchestrator', triggeredBy: 'rule_enforcement', agentId: step.agentId }` to distinguish it from an agent-fired gate where the actor is `{ type: 'agent', agentId: step.agentId }`.

---

## 10. How to Run

```bash
# Start all infrastructure
docker compose -f infra/docker-compose.yml up -d

# Verify healthy (must exit 0 before proceeding)
bash infra/healthcheck.sh

# Install dependencies
pnpm install

# Apply migrations and seed default harness
pnpm --filter api prisma migrate deploy
pnpm --filter api prisma db seed

# Start API + Temporal worker
pnpm --filter api dev

# Start frontend
pnpm --filter web dev
```

| Service | URL |
|---|---|
| API | http://localhost:3001 |
| Frontend | http://localhost:3000 |
| Temporal UI | http://localhost:8080 |

**`apps/api/.env`**
```
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379
TEMPORAL_ADDRESS=localhost:7233
ANTHROPIC_API_KEY=<Devin secrets vault>
OPENAI_API_KEY=<Devin secrets vault>
JWT_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
HARNESS_ID=default
LOG_LEVEL=info
FRONTEND_URL=http://localhost:3000
TRIGGER_PREFIX=@finch
```

> **Security:** Generate strong credentials for all environments. Never use default or trivial passwords. Ensure `.env` is listed in `.gitignore` and never committed to version control.

---

## 11. Implementation Waves

| Wave | Deliverable | Done when |
|---|---|---|
| 1 | Monorepo scaffold, Docker Compose, NestJS skeleton, module stubs, Prisma schema + migrations, `/health` | `docker compose up` + `pnpm build` + migrations clean |
| 2 | All repositories (including `getPersistedPipelineArtifact`), seed data, `finchWorkflow` with stub activities end-to-end | Workflow COMPLETED in Temporal UI and Postgres |
| 3 | All 5 agents with real LLM loops, locked preamble, gate fire + resume. Minimal `WebhookConnectorService` (POST endpoint, no HMAC). Gate question logged to audit log; resolved via `POST /api/gate/:id/respond` | Vague task via Webhook → Gate A fires → question in audit log → resolved via API → run completes |
| 4 | Slack connector (full), GitHub connectors (Acquire/Execute/Ship), Jira connector, Socket.io gateway, HMAC on Webhook | Slack trigger starts run, Socket.io delivers live events, GitHub Ship opens PR |
| 5 | Multi-repo support + full memory system (staging, merge, semantic query) | Multi-repo PRs created, memory persists across runs |
| 6 | React UI + Prometheus + Grafana + Playwright e2e | Playwright tests pass, full run observable in UI |

Progress tracked in `TASKS.md`. Complete and verify each wave before starting the next.

---

## 12. Definition of Done

A task is done when **all** of the following pass:

1. `docker compose -f infra/docker-compose.yml up -d` succeeds and `bash infra/healthcheck.sh` exits 0
2. The feature works against the **live running application** — not mocks
3. Temporal workflows show expected status in Temporal UI at `http://localhost:8080`
4. `pnpm --filter api test` passes for all affected modules
5. `pnpm --filter api exec tsc --noEmit` produces zero errors
6. No `any` types introduced

---

## 13. Rules and Skills

**Read `RULES.md` before implementing any module.** It contains all hard and soft implementation rules with enforcement level. Hard rule violations are defects. Soft rule deviations require a note in the commit message.

**Read the relevant skill file before implementing the corresponding system:**

| File | When to read |
|---|---|
| `skills/temporal-patterns.md` | Before any work in `workflow/` or any Temporal Activity |
| `skills/nestjs-patterns.md` | Before any new NestJS module, service, guard, or controller |

---

## 14. Blocked Tasks

After 3 failed fix attempts: write a `## Blocked` entry in `TASKS.md` with the task ID, exact error, what was tried, and what information is needed to unblock. Then move to the next independent task.
