# Finch — Software Design Document

**Version:** 2.0
**Status:** Draft
**Date:** April 2026
**Framework Reference:** TAPES v1 (Trigger · Acquire · Plan · Execute · Ship)
**Supersedes:** Version 1.0

---

## Table of Contents

1. Introduction
2. System Overview
3. Framework Fidelity Constraints
4. Technology Stack
5. NestJS Module Architecture
6. Temporal Workflow Engine
7. Orchestration Core
8. Agent Architecture
9. Multi-Agent Pipelines
10. Agent-to-Agent Communication Model
11. Clarification Gate Protocol
12. Memory System
13. Connector System
14. Artifact Schemas
15. Database Design
16. API Design
17. Real-time Layer
18. Frontend Architecture
19. Security Design
20. Infrastructure and Deployment
21. Testing Strategy
22. Observability

---

## 1. Introduction

### 1.1 Purpose

This document is the authoritative software design specification for the Finch implementation. It defines every architectural decision, technology choice, module boundary, data schema, communication pattern, and implementation guideline required to build the system. It is intended to be comprehensive enough that an engineering team can begin implementation directly from this document without needing to resolve fundamental design questions independently.

### 1.2 Scope

This document covers the full Finch system: the orchestration core, the agent layer, the connector system, the memory system, the persistence layer, the real-time infrastructure, the frontend application, the security model, the deployment architecture, and the testing strategy.

### 1.3 Relationship to the TAPES Paper and PRD

The TAPES paper defines the framework. The PRD defines the product requirements. This document defines how to build the product that implements the framework. When this document conflicts with the PRD, the PRD takes precedence. When the PRD conflicts with the TAPES paper, the paper takes precedence. The paper's constraints are treated as inviolable.

### 1.4 Definitions

- **Run** — a single TAPES lifecycle instance from Trigger to Ship
- **Phase** — one of five stages: Trigger, Acquire, Plan, Execute, Ship
- **Gate** — a clarification checkpoint that fires when an agent identifies an unresolvable context gap
- **Artifact** — the canonical typed output of a phase, passed forward to the next phase
- **Harness** — a configured Finch deployment instance with its own connectors, agents, memory store, and settings
- **Agent** — a stateless LLM-powered component responsible for executing a single phase
- **Pipeline** — an ordered sequence of agents within a single phase
- **Activity** — a Temporal unit of work; the implementation of a phase invocation
- **Workflow** — a Temporal durable execution unit; the TAPES lifecycle
- **Pipeline Position** — the zero-based index of an agent within a phase pipeline
- **Point of Suspension** — the pipeline position at which a gate fired; resume restarts from this position, not from zero

---

## 2. System Overview

Finch is a phased orchestration engine for software development teams. It receives tasks through configured trigger sources, autonomously acquires context, produces an explicit plan, executes implementation work, and ships a deliverable — maintaining structured human-in-the-loop checkpoints wherever the agent identifies a gap in its understanding.

The system has five architectural layers:

**Layer 1 — Frontend (Web UI).** A React application providing run monitoring, connector configuration, memory browsing, agent pipeline configuration, audit log access, and gate response handling. Updates in real time via WebSocket.

**Layer 2 — API Server (NestJS).** The HTTP and WebSocket server. Handles authentication, request validation, business logic orchestration, and real-time event distribution. Starts and signals Temporal workflows. Does not hold authoritative run state.

**Layer 3 — Temporal Workflow Engine.** The durable execution substrate. Owns the Finch lifecycle state machine. Handles phase sequencing, gate suspension and resumption, backward phase traversal, crash recovery, and multi-repo Ship fan-out. The single source of truth for where any run is in its lifecycle.

**Layer 4 — Agent Layer.** Stateless NestJS services that implement phase logic as Temporal Activities. Each agent service receives an input artifact, runs an LLM-powered agentic loop with tool calling, and produces either an output artifact or a gate event. Agents are stateless workers — they do not hold session state between invocations.

**Layer 5 — Persistence and Infrastructure.** PostgreSQL for structured data, Redis for queues and pub/sub, pgvector for semantic memory, Temporal's own database for workflow state.

### 2.1 Complete Phase Lifecycle

All five phases are visible in the run timeline. Every phase produces audit events. No phase is collapsed into infrastructure code outside the workflow.

```
RawTriggerInput arrives (Slack / Webhook / Cron)
  → Temporal workflow starts
    → runTriggerPhase    → TaskDescriptor
    → runAcquirePhase    → ContextObject        [Gate A possible]
    → runPlanPhase       → PlanArtifact         [Gate P possible]
    → runExecutePhase    → VerificationReport   [Gate E possible]
    → runShipPhase       → ShipResult           [fan-out for multi-repo]
    → mergeRunMemory
    → markRunCompleted
```

---

## 3. Framework Fidelity Constraints

The following constraints are derived directly from the TAPES paper and PRD and are treated as hard architectural requirements. Any design decision that violates these is a defect.

**FC-01.** The Trigger phase is stateless. It normalizes an inbound signal into a TaskDescriptor and passes it forward. It writes nothing to memory or persistent state beyond the TaskDescriptor itself. It is a proper phase inside the workflow with audit events — it is not collapsed into connector infrastructure.

**FC-02.** All three clarification gates — Gate A, Gate P, Gate E — fire under the identical condition: the agent has self-identified a specific context gap it cannot resolve from available sources. No gate has a distinct or specialized trigger condition.

**FC-03.** The plan produced in the Plan phase does not require human approval before execution proceeds. Gate P fires only when the agent lacks context to produce a coherent plan — not to seek sign-off. The system must never implement a waiting-for-plan-approval state.

**FC-04.** The Execute phase is strictly bounded by the plan artifact. The agent cannot silently expand scope, modify components not covered by the plan, or change approach. Silent deviation is never permitted.

**FC-05.** Gate firings are pauses, not restarts. No completed work is discarded on resume. When a gate fires at pipeline position N, agents at positions 0 through N-1 are not re-run on resume. Their outputs are preserved in the gate snapshot and restored.

**FC-06.** Backward phase traversal is permitted and expected. A Gate E resolution may require returning to Plan before execution resumes. A Gate P resolution may require returning to Acquire. What resumability prohibits is a full reset, not intelligent traversal.

**FC-07.** The Ship phase has no clarification gate. Ship is deterministic given a passing Execute phase.

**FC-08.** The system must support incremental trust: as the agent accumulates domain knowledge through memory, gate frequency should naturally decrease over time.

**FC-09.** The gate condition is framework-owned and locked. It is injected as a protected preamble into every agent's system prompt by the orchestration core at instantiation time. Users cannot edit, override, or remove it through any UI or configuration surface.

**FC-10.** Resume means point-of-suspension resume. The pipeline resumes from the agent that fired the gate, passing it the enriched artifact (snapshot artifact plus gate resolution injected). Prior agents in the pipeline are not re-run.

---

## 4. Technology Stack

### 4.1 Complete Technology List

| Layer | Technology | Rationale |
|---|---|---|
| Language | TypeScript (strict mode) | Shared artifact schemas across layers; compile-time safety on complex nested types |
| Runtime | Node.js 20 LTS | Stable async model; long-term support |
| Backend framework | NestJS 10 | Dependency injection solves connector registry; module system maps onto architecture; built-in guards, pipes, interceptors; WebSocket support; BullMQ integration |
| Workflow engine | Temporal | Durable execution; native pause/resume for gates; crash recovery; built-in event history; parallel activities for multi-repo Ship fan-out |
| ORM | Prisma | Type-safe database client; migration management; JSONB support for artifact storage |
| Primary database | PostgreSQL 16 + pgvector | Relational store for runs, gates, config, audit; pgvector for semantic memory search |
| Cache and queue backend | Redis 7 | BullMQ job queues; pub/sub for WebSocket event distribution |
| Job queue | BullMQ | Audit write queue; memory indexing; gate timeouts |
| WebSocket | Socket.io | Rooms scoped per harness; Redis adapter for multi-instance deployments |
| Anthropic integration | @anthropic-ai/sdk | Claude models; native tool use API |
| OpenAI integration | openai SDK | GPT-4o and o-series; embedding model for memory; Haiku-class model for rule evaluation |
| Slack integration | @slack/bolt | Events API; OAuth; message threading |
| GitHub integration | @octokit/rest + simple-git | REST API for PR management; local git operations for Execute phase |
| Jira integration | jira.js | Jira REST API v3 |
| AST-aware file editing | ts-morph | Structured TypeScript/JavaScript file modification in Execute phase |
| Embedding model | text-embedding-3-small (OpenAI) | 1536-dimension vectors; configurable to any provider |
| Frontend framework | React 18 | Component model; concurrent features |
| Build tool | Vite | Fast HMR; native ESM |
| Client routing | TanStack Router | Type-safe routes |
| Server state | TanStack Query | Caching; background refetch |
| UI primitives | Radix UI | Accessible, unstyled primitives |
| Styling | CSS Modules | Scoped styles; no runtime overhead |
| Charts | Recharts | Gate frequency trends; cycle time analytics |
| Code editor (UI) | Monaco Editor | System prompt body editing |
| Virtual lists | @tanstack/virtual | Audit log rendering at scale |
| Unit and integration tests | Vitest + Supertest | Fast; TypeScript-first |
| HTTP mocking | msw | Request interception for connector tests |
| E2E tests | Playwright | Full-stack browser automation |
| Logging | Pino | Structured JSON logs; low overhead |
| Metrics | OpenTelemetry + Prometheus | Auto-instrumented spans; custom Finch metrics |
| Dashboards | Grafana | Gate frequency; cycle time; LLM cost |
| Error tracking | Sentry | Unhandled exceptions with run_id and harness_id tags |
| Containerization | Docker + Docker Compose | Reproducible local dev; multi-stage builds |
| Production orchestration | Kubernetes + Helm | Horizontal scaling; rolling deploys |
| CI/CD | GitHub Actions | Lint, test, build, deploy pipeline |
| Secrets management | Kubernetes Secrets / HashiCorp Vault | Connector credentials; LLM API keys; JWT secrets |
| Authentication | JWT in httpOnly cookies | Short-lived access tokens; refresh rotation |
| Credential encryption | AES-256-GCM (Node.js crypto) | Connector credentials at rest |
| Rate limiting | @nestjs/throttler | Trigger and gate response endpoints |
| Ephemeral workspaces | tmp (Node.js) | Execute phase sandbox directories |

### 4.2 Key Architectural Decisions

**NestJS over Fastify or Express.** The connector registry, the agent pipeline, the LLM provider registry, the memory system, and the rule enforcement system all require a proper dependency injection container. NestJS provides DI, a module system with explicit encapsulation boundaries, lifecycle hooks that connectors use to self-register, built-in guards for locked preamble enforcement, and deep integration with every library the system needs.

**Temporal over a hand-rolled orchestration core.** The PRD's RunManager, PhaseRouter, and GateController describe durable execution, pause/resume semantics, and crash-safe state management. That is precisely what Temporal is. Temporal additionally provides native parallel activity execution, which is used for multi-repo Ship fan-out. TAPES-specific logic is written on top of Temporal, not instead of it.

**pgvector over a separate vector database.** At the scale of the reference implementation, pgvector with an HNSW index delivers sub-500ms query performance without a separate infrastructure dependency. The MemoryConnector interface abstracts this so migration to a dedicated vector store is an implementation swap.

**Hybrid rule enforcement.** Deterministic path and pattern evaluation handles most rule types with no LLM call. Semantic rules that cannot be evaluated by pattern matching use a Haiku-class model for classification. Purely deterministic enforcement is insufficient because the PRD's own example rules include semantic constraints.

---

## 5. NestJS Module Architecture

### 5.1 Module Tree

```
AppModule
├── OrchestratorModule
│   ├── GateControllerService
│   ├── AgentDispatcherService
│   └── RuleEnforcementService
├── WorkflowModule
│   └── TemporalWorkerService
├── AgentModule
│   ├── TriggerAgentService
│   ├── AcquireAgentService
│   ├── PlanAgentService
│   ├── ExecuteAgentService
│   ├── ShipAgentService
│   ├── AgentFactory
│   └── AgentConfigService
├── ConnectorModule
│   ├── ConnectorRegistryService
│   ├── SlackConnectorService
│   ├── WebhookConnectorService
│   ├── CronConnectorService
│   ├── JiraConnectorService
│   ├── GitHubAcquireConnectorService
│   ├── GitHubExecuteConnectorService
│   └── GitHubShipConnectorService
├── LLMModule
│   ├── LLMRegistryService
│   ├── AnthropicConnectorService
│   └── OpenAIConnectorService
├── MemoryModule
│   ├── MemoryConnectorService
│   ├── MemoryActivities
│   ├── MemoryStagingService
│   └── EmbeddingService
├── AuditModule
│   └── AuditLoggerService
├── PersistenceModule
│   ├── PrismaService
│   ├── RunRepository
│   ├── GateRepository
│   ├── ArtifactRepository
│   └── HarnessRepository
├── WebSocketModule
│   └── RunGateway
├── AuthModule
│   ├── AuthService
│   ├── JwtStrategy
│   └── HarnessAuthGuard
└── ApiModule
    ├── RunsController
    ├── GatesController
    ├── MemoryController
    ├── ConnectorsController
    ├── AgentsController
    ├── AnalyticsController
    └── TriggerController
```

### 5.2 Module Dependency Rules

- `OrchestratorModule` imports `AgentModule`, `ConnectorModule`, `MemoryModule`, `AuditModule`, `PersistenceModule`, `LLMModule`
- `AgentModule` imports `LLMModule`, `ConnectorModule`, `MemoryModule`, `AuditModule`, `PersistenceModule`
- `ConnectorModule` imports `PersistenceModule`
- `MemoryModule` imports `LLMModule`, `PersistenceModule`, `AuditModule`
- `AuditModule` imports `PersistenceModule`
- `WebSocketModule` imports `AuditModule`
- `ApiModule` imports all other modules
- `WorkflowModule` imports `AgentModule`, `MemoryModule`, `OrchestratorModule`

No circular imports. `PersistenceModule` and `AuditModule` are leaf dependencies.

---

## 6. Temporal Workflow Engine

### 6.1 Role of Temporal

Temporal is the execution substrate for the TAPES lifecycle. It owns:

- The durable state of every run from Trigger to Ship
- The complete five-phase sequencing logic including the Trigger phase
- The gate suspension and resumption mechanism
- Crash recovery at the activity level
- Backward phase traversal routing
- Parallel activity execution for multi-repo Ship fan-out
- The audit trail of every workflow execution step

NestJS services implement the business logic. Temporal enforces the execution guarantees.

### 6.2 Workflow Definition

The Temporal workflow function is the TAPES lifecycle. It is deterministic — no I/O, no randomness, no external calls. All side effects happen inside Activities. The workflow accepts `RawTriggerInput` — raw connector output before any normalization. The first activity is always `runTriggerPhase`.

```typescript
// workflows/finch.workflow.ts

import {
  proxyActivities,
  condition,
  setHandler,
  defineSignal,
} from '@temporalio/workflow';
import type { FinchActivities } from '../activities/finch.activities';

export const gateResolvedSignal = defineSignal<[GateResolution]>('gate_resolved');
export const stopRunSignal = defineSignal('stop_run');

export async function finchWorkflow(rawInput: RawTriggerInput): Promise<RunResult> {
  const acts = proxyActivities<FinchActivities>({
    startToCloseTimeout: '15 minutes',
    retry: {
      maximumAttempts: 3,
      nonRetryableErrorTypes: ['GateRequiredError', 'ScopeViolationError'],
    },
  });

  let stopped = false;
  setHandler(stopRunSignal, () => { stopped = true; });

  // ── TRIGGER ───────────────────────────────────────────────
  // First activity in every run. Stateless — no memory writes,
  // no gates. Produces the TaskDescriptor used by all subsequent phases.
  const taskDescriptor = await acts.runTriggerPhase(rawInput);

  if (stopped) return { status: 'STOPPED', phase: 'TRIGGER' };

  // ── ACQUIRE ───────────────────────────────────────────────
  let contextObject = await acts.runAcquirePhase(taskDescriptor);

  while (contextObject.hasGap) {
    if (stopped) return { status: 'STOPPED', phase: 'ACQUIRE' };

    const resolution = await waitForGateResolution(taskDescriptor.runId);
    if (stopped) return { status: 'STOPPED', phase: 'ACQUIRE' };

    if (resolution.requiresPhase === 'ACQUIRE') {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'ACQUIRE',
        toPhase: 'ACQUIRE',
      });
    }

    contextObject = await acts.resumeAcquirePhase(contextObject, resolution);
  }

  // ── PLAN ──────────────────────────────────────────────────
  let planArtifact = await acts.runPlanPhase(contextObject);

  while (planArtifact.hasGap) {
    if (stopped) return { status: 'STOPPED', phase: 'PLAN' };

    const resolution = await waitForGateResolution(taskDescriptor.runId);
    if (stopped) return { status: 'STOPPED', phase: 'PLAN' };

    if (resolution.requiresPhase === 'ACQUIRE') {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'PLAN',
        toPhase: 'ACQUIRE',
      });
      contextObject = await acts.resumeAcquirePhase(contextObject, resolution);
      planArtifact = await acts.runPlanPhase(contextObject);
    } else {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'PLAN',
        toPhase: 'PLAN',
      });
      planArtifact = await acts.resumePlanPhase(planArtifact, resolution);
    }
  }

  // ── EXECUTE ───────────────────────────────────────────────
  let verificationReport = await acts.runExecutePhase(planArtifact, contextObject);

  while (verificationReport.hasGap) {
    if (stopped) return { status: 'STOPPED', phase: 'EXECUTE' };

    const resolution = await waitForGateResolution(taskDescriptor.runId);
    if (stopped) return { status: 'STOPPED', phase: 'EXECUTE' };

    if (resolution.requiresPhase === 'ACQUIRE') {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'EXECUTE',
        toPhase: 'ACQUIRE',
      });
      contextObject = await acts.resumeAcquirePhase(contextObject, resolution);
      planArtifact = await acts.runPlanPhase(contextObject);
      verificationReport = await acts.runExecutePhase(planArtifact, contextObject);
    } else if (resolution.requiresPhase === 'PLAN') {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'EXECUTE',
        toPhase: 'PLAN',
      });
      planArtifact = await acts.resumePlanPhase(planArtifact, resolution);
      verificationReport = await acts.runExecutePhase(planArtifact, contextObject);
    } else {
      await acts.logTraversalEvent({
        runId: taskDescriptor.runId,
        gateId: resolution.gateId,
        fromPhase: 'EXECUTE',
        toPhase: 'EXECUTE',
      });
      verificationReport = await acts.resumeExecutePhase(verificationReport, resolution);
    }
  }

  // ── SHIP ──────────────────────────────────────────────────
  const repos = await acts.getRegisteredRepos(contextObject.harnessId);

  if (repos.length === 1) {
    const shipResult = await acts.runShipPhase(
      planArtifact, verificationReport, contextObject, repos[0].repoId,
    );
    // Memory merge is an orchestration core responsibility — not the agent's
    await acts.mergeRunMemory(planArtifact.runId);
    await acts.aggregateShipResults(planArtifact.runId, [
      { repoId: repos[0].repoId, status: 'success', result: shipResult },
    ]);
  } else {
    // Multi-repo: parallel fan-out
    // Each repo gets its own ShipAgent invocation
    const shipPromises = repos.map(repo =>
      acts.runShipPhase(planArtifact, verificationReport, contextObject, repo.repoId)
        .then(result => ({ repoId: repo.repoId, status: 'success' as const, result }))
        .catch(err => ({ repoId: repo.repoId, status: 'failed' as const, error: err.message }))
    );

    const shipResults = await Promise.all(shipPromises);

    // Merge memory after all Ship activities resolve, regardless of individual outcomes
    await acts.mergeRunMemory(planArtifact.runId);

    // Mark run COMPLETED when all have resolved — success or logged failure
    // Individual Ship failures are surfaced in audit and UI but do not block completion
    await acts.aggregateShipResults(planArtifact.runId, shipResults);
  }

  return { status: 'COMPLETED' };
}

async function waitForGateResolution(runId: string): Promise<GateResolution> {
  let resolution: GateResolution | null = null;
  setHandler(gateResolvedSignal, (r) => { resolution = r; });
  await condition(() => resolution !== null, '48 hours');
  if (!resolution) throw new Error(`Gate timeout for run ${runId}`);
  return resolution;
}
```

### 6.3 Activities Registration

```typescript
// workflow/temporal-worker.service.ts

@Injectable()
export class TemporalWorkerService implements OnModuleInit {
  constructor(
    private readonly triggerAgent: TriggerAgentService,
    private readonly acquireAgent: AcquireAgentService,
    private readonly planAgent: PlanAgentService,
    private readonly executeAgent: ExecuteAgentService,
    private readonly shipAgent: ShipAgentService,
    private readonly memoryActivities: MemoryActivities,
    private readonly auditActivities: AuditActivities,
    private readonly harnessActivities: HarnessActivities,
    private readonly runRepository: RunRepository,
  ) {}

  async onModuleInit() {
    const worker = await Worker.create({
      workflowsPath: require.resolve('./finch.workflow'),
      activities: {
        // Trigger
        runTriggerPhase:     this.triggerAgent.runPhase.bind(this.triggerAgent),

        // Acquire
        runAcquirePhase:     this.acquireAgent.runPhase.bind(this.acquireAgent),
        resumeAcquirePhase:  this.acquireAgent.resumePhase.bind(this.acquireAgent),

        // Plan
        runPlanPhase:        this.planAgent.runPhase.bind(this.planAgent),
        resumePlanPhase:     this.planAgent.resumePhase.bind(this.planAgent),

        // Execute
        runExecutePhase:     this.executeAgent.runPhase.bind(this.executeAgent),
        resumeExecutePhase:  this.executeAgent.resumePhase.bind(this.executeAgent),

        // Ship
        runShipPhase:        this.shipAgent.runPhase.bind(this.shipAgent),
        aggregateShipResults: this.shipAgent.aggregateResults.bind(this.shipAgent),
        getRegisteredRepos:  this.harnessActivities.getRegisteredRepos.bind(this.harnessActivities),

        // Memory — orchestration core responsibility, not agent responsibility
        mergeRunMemory:      this.memoryActivities.mergeRunMemory.bind(this.memoryActivities),

        // Audit
        logTraversalEvent:   this.auditActivities.logTraversalEvent.bind(this.auditActivities),
      },
      taskQueue: 'finch',
      maxConcurrentActivities: 20,
    });

    await worker.run();
  }
}
```

### 6.4 Starting a Workflow

Connector services pass `RawTriggerInput` to the workflow starter. Normalization happens inside the workflow as the first activity — not in the connector.

```typescript
// In SlackConnectorService or WebhookConnectorService

const rawInput: RawTriggerInput = {
  rawText: event.text,
  source: {
    type: 'slack',
    channelId: event.channel,
    messageId: event.ts,
    threadTs: event.ts,
    authorId: event.user,
    timestamp: new Date(Number(event.ts) * 1000),
  },
  harnessId: this.config.get('HARNESS_ID'),
  runId: uuidv4(),
};

const client = new WorkflowClient();
const handle = await client.start(finchWorkflow, {
  args: [rawInput],
  taskQueue: 'finch',
  workflowId: `finch-${rawInput.runId}`,
});

await this.runRepository.create({
  runId: rawInput.runId,
  harnessId: rawInput.harnessId,
  temporalWorkflowId: handle.workflowId,
  status: 'RUNNING',
  phase: 'TRIGGER',
});
```

---

## 7. Orchestration Core

### 7.1 GateControllerService

```typescript
@Injectable()
export class GateControllerService {
  constructor(
    private readonly gateRepository: GateRepository,
    private readonly runRepository: RunRepository,
    private readonly connectorRegistry: ConnectorRegistryService,
    private readonly llmRegistry: LLMRegistryService,
    private readonly auditLogger: AuditLoggerService,
    private readonly temporalClient: WorkflowClient,
    private readonly bullQueue: Queue,
  ) {}

  async dispatch(gateEvent: GateEvent): Promise<void> {
    // 1. Persist the typed snapshot before anything else — durability first
    await this.gateRepository.create(gateEvent);

    // 2. Update run status
    await this.runRepository.updateStatus(gateEvent.runId, 'WAITING_FOR_HUMAN');

    // 3. Send the question to the trigger channel
    const triggerConnector = this.connectorRegistry.getTriggerConnector(gateEvent.harnessId);
    await triggerConnector.sendMessage({
      channelId: gateEvent.source.channelId,
      threadTs: gateEvent.source.threadTs,
      message: this.formatGateQuestion(gateEvent),
    });

    // 4. Schedule timeout check
    await this.bullQueue.add(
      'gate-timeout',
      { gateId: gateEvent.gateId, runId: gateEvent.runId },
      {
        delay: gateEvent.timeoutMs ?? 48 * 60 * 60 * 1000,
        jobId: `gate-timeout:${gateEvent.gateId}`,
      },
    );

    // 5. Log
    await this.auditLogger.log({
      runId: gateEvent.runId,
      phase: gateEvent.phase,
      eventType: 'gate_question_sent',
      payload: { gateId: gateEvent.gateId, question: gateEvent.question },
    });
  }

  async resolve(gateId: string, answer: string): Promise<void> {
    const gateEvent = await this.gateRepository.findById(gateId);

    if (!gateEvent) throw new NotFoundException(`Gate ${gateId} not found`);
    if (gateEvent.resolvedAt) throw new ConflictException(`Gate ${gateId} already resolved`);

    // 1. Evaluate traversal requirement
    const traversal = await this.evaluateTraversal(gateEvent, answer);

    const resolution: GateResolution = {
      gateId,
      answer,
      resolvedAt: new Date(),
      requiresPhase: traversal.targetPhase,
      snapshot: gateEvent.snapshot,
    };

    // 2. Persist resolution
    await this.gateRepository.saveResolution(gateId, resolution);

    // 3. Cancel timeout job
    const timeoutJob = await this.bullQueue.getJob(`gate-timeout:${gateId}`);
    if (timeoutJob) await timeoutJob.remove();

    // 4. Update run status
    await this.runRepository.updateStatus(gateEvent.runId, 'RUNNING');

    // 5. Signal Temporal workflow — carries the full typed snapshot back
    const run = await this.runRepository.findById(gateEvent.runId);
    const handle = this.temporalClient.getHandle(run.temporalWorkflowId);
    await handle.signal(gateResolvedSignal, resolution);

    // 6. Log
    await this.auditLogger.log({
      runId: gateEvent.runId,
      phase: gateEvent.phase,
      eventType: 'gate_resumed',
      payload: { gateId, resolution },
    });
  }

  private async evaluateTraversal(
    gateEvent: GateEvent,
    answer: string,
  ): Promise<TraversalDecision> {
    // Gate A always resumes in Acquire
    if (gateEvent.phase === 'ACQUIRE') {
      return { targetPhase: 'ACQUIRE' };
    }

    // Gate P and Gate E: small classification call
    const llm = this.llmRegistry.getDefault(gateEvent.harnessId);

    const prompt = `
You are evaluating whether a gate resolution requires backward phase traversal in the TAPES framework.

Gate fired in phase: ${gateEvent.phase}
Gap description: ${gateEvent.gapDescription}
Human answer: ${answer}
${gateEvent.phase === 'EXECUTE' ? `Current plan summary: ${(gateEvent.snapshot as GateESnapshot).planArtifact.proposedApproach}` : ''}

Determine the minimum phase that must be re-entered.
- If the answer only adds information that lets the current phase continue: return ${gateEvent.phase}
- If the answer changes approach or scope requiring a new plan: return PLAN
- If the answer reveals the original context was fundamentally wrong: return ACQUIRE

Respond with exactly one word: ACQUIRE, PLAN, or EXECUTE.
    `.trim();

    const response = await llm.complete({
      messages: [{ role: 'user', content: prompt }],
      system: 'Respond with exactly one word.',
      model: 'claude-haiku-4-5',
      maxTokens: 10,
    });

    const targetPhase = response.text.trim() as Phase;
    return { targetPhase };
  }

  private formatGateQuestion(gateEvent: GateEvent): string {
    return [
      `*Finch needs clarification* (Run: \`${gateEvent.runId}\`, Phase: ${gateEvent.phase})`,
      '',
      `*Gap identified:*`,
      gateEvent.gapDescription,
      '',
      `*Question:*`,
      gateEvent.question,
      '',
      `_Reply in this thread to resume execution. Gate ID: \`${gateEvent.gateId}\`_`,
    ].join('\n');
  }
}
```

### 7.2 AgentDispatcherService

The dispatcher is the central implementation point for pipeline position tracking, point-of-suspension resume, crash recovery, hard rule enforcement at phase boundaries, soft rule deviation detection, and all intra-pipeline audit events.

```typescript
@Injectable()
export class AgentDispatcherService {
  constructor(
    private readonly agentFactory: AgentFactory,
    private readonly agentConfigService: AgentConfigService,
    private readonly auditLogger: AuditLoggerService,
    private readonly runRepository: RunRepository,
    private readonly ruleEnforcementService: RuleEnforcementService,
  ) {}

  async runPhase<TArtifact>(params: {
    phase: Phase;
    inputArtifact: TArtifact;
    runId: string;
    harnessId: string;
    planArtifact?: PlanArtifact;       // carried through for Gate E snapshots and rule checks
    contextObject?: ContextObject;     // carried through for Gate E snapshots
    resumeFromSnapshot?: GateSnapshot; // present on gate resume
    source: TriggerSource;
  }): Promise<TArtifact | GateEvent> {

    const pipeline = await this.agentConfigService.getPipeline(params.phase, params.harnessId);

    // ── CRASH RECOVERY ────────────────────────────────────────────────────────
    // On Temporal replay after a server crash, read the last persisted pipeline
    // position and artifact from the database. The dispatcher resumes from there
    // rather than restarting at position zero.
    //
    // pipeline_artifact stores the artifact at the LAST COMPLETED position.
    // This is intentional and sufficient for crash recovery.
    //
    // Example — three-agent pipeline, AgentC crashed:
    //   pipeline_position = 2 (AgentC's position, set BEFORE invocation)
    //   pipeline_artifact = AgentB's output (what AgentC was about to receive)
    //
    // We only need the artifact at startPosition - 1, not a per-position store.
    // Each agent's output becomes the next agent's input, so the last persisted
    // artifact is always exactly what the resuming agent needs.
    //
    // Contrast with gate resume: the gate snapshot explicitly stores all prior
    // agent outputs because the snapshot may be created after multiple agents
    // have completed. Crash recovery does not need this because pipeline_artifact
    // is updated BEFORE every agent invocation — it is always current.
    const persisted = await this.runRepository.getPipelineState(params.runId, params.phase);

    const crashRecoveryPosition = persisted?.pipelinePosition ?? 0;
    const crashRecoveryArtifact = persisted?.pipelineArtifact
      ? (persisted.pipelineArtifact as TArtifact)
      : params.inputArtifact;

    // Gate resume position takes priority over crash recovery position.
    // If both exist, the gate snapshot is more precise and more recent.
    const startPosition = params.resumeFromSnapshot?.pipelinePosition
      ?? crashRecoveryPosition;

    let artifact = params.resumeFromSnapshot
      ? this.restoreArtifactFromSnapshot(params.resumeFromSnapshot, params.inputArtifact)
      : crashRecoveryArtifact;

    // ── PIPELINE EXECUTION ────────────────────────────────────────────────────
    for (const step of pipeline) {

      // Skip agents that completed before the gate fired or before the crash.
      // Their outputs are preserved — we restore the artifact and advance.
      if (step.position < startPosition) {
        const priorOutput = params.resumeFromSnapshot
          ? params.resumeFromSnapshot.agentOutputsBeforeGate
              .find(o => o.position === step.position)?.artifact
          : persisted?.pipelineArtifact;

        if (priorOutput) artifact = priorOutput as TArtifact;

        await this.auditLogger.log({
          runId: params.runId,
          phase: params.phase,
          eventType: 'agent_skipped_on_resume',
          actor: { agentId: step.agentId },
          payload: { position: step.position, reason: 'completed_before_gate_or_crash' },
        });

        continue;
      }

      // ── HARD RULE CHECK (PHASE BOUNDARY) ──────────────────────────────────
      // Check hard rules that apply to this phase before invoking the agent.
      // This covers rules like "always assign security reviewer if /auth is in scope"
      // which are naturally enforced at phase entry, not mid-execution.
      const hardRuleViolation = await this.ruleEnforcementService.checkHardRules({
        harnessId: params.harnessId,
        runId: params.runId,
        phase: params.phase,
        actionType: 'phase_entry',
        description: `Entering ${params.phase} at pipeline position ${step.position}, agent ${step.agentId}`,
        planArtifact: params.planArtifact,
        currentArtifact: artifact,
      });

      if (hardRuleViolation.violated) {
        // Hard rule violation fires a gate — same path as agent-fired gates.
        // Rule constraint is included in the gate question (RU-02).
        const gateEvent = new GateEvent({
          phase: params.phase,
          runId: params.runId,
          harnessId: params.harnessId,
          gapDescription: `Hard rule violated before agent execution: ${hardRuleViolation.rule.name}`,
          question: hardRuleViolation.gateQuestion,
          source: params.source,
          agentId: step.agentId,
          pipelinePosition: step.position,
          temporalWorkflowId: params.temporalWorkflowId,
          timeoutMs: params.timeoutMs,
        });
        gateEvent.snapshot = this.buildSnapshot(
          params.phase,
          step.position,
          artifact,
          pipeline,
          params.planArtifact,
          params.contextObject,
          params.resumeFromSnapshot,
        );
        return gateEvent;
      }

      // ── PERSIST POSITION BEFORE INVOCATION ────────────────────────────────
      // Written BEFORE the agent is invoked. If the server crashes inside the
      // agent call, Temporal replays the activity and the dispatcher finds this
      // position persisted — it skips to here rather than restarting at zero.
      await this.runRepository.updatePipelinePosition(params.runId, params.phase, step.position, artifact);

      // ── SKILL APPLIED AUDIT ────────────────────────────────────────────────
      for (const skill of step.skills) {
        await this.auditLogger.log({
          runId: params.runId,
          phase: params.phase,
          eventType: 'skill_applied',
          actor: { agentId: step.agentId },
          payload: { skillId: skill.skillId, skillName: skill.name, version: skill.version },
        });
      }

      await this.auditLogger.log({
        runId: params.runId,
        phase: params.phase,
        eventType: 'agent_invoked',
        actor: { agentId: step.agentId, llmProvider: step.llmProvider, model: step.model },
        payload: { pipelinePosition: step.position, inputArtifact: artifact },
      });

      const agent = this.agentFactory.create(params.phase, step.agentId);
      const result = await agent.run(artifact, {
        runId: params.runId,
        harnessId: params.harnessId,
        agentConfig: step,
        planArtifact: params.planArtifact,
        contextObject: params.contextObject,
        source: params.source,
      });

      await this.auditLogger.log({
        runId: params.runId,
        phase: params.phase,
        eventType: 'agent_completed',
        actor: { agentId: step.agentId },
        payload: { output: result },
      });

      if (result instanceof GateEvent) {
        // Attach typed snapshot before returning up to the activity layer
        result.snapshot = this.buildSnapshot(
          params.phase,
          step.position,
          artifact,
          pipeline,
          params.planArtifact,
          params.contextObject,
          params.resumeFromSnapshot,
        );
        return result;
      }

      // ── SOFT RULE CHECK (POST-AGENT) ───────────────────────────────────────
      // Soft rule deviations are detected after the agent produces output.
      // They are logged as rule_deviation audit events but do not block
      // the pipeline — the agent is not stopped or gated.
      await this.ruleEnforcementService.checkSoftRules({
        harnessId: params.harnessId,
        runId: params.runId,
        phase: params.phase,
        agentId: step.agentId,
        description: `Agent ${step.agentId} completed phase ${params.phase}`,
        outputArtifact: result,
        planArtifact: params.planArtifact,
      });

      // ── ARTIFACT HANDOFF ───────────────────────────────────────────────────
      await this.auditLogger.log({
        runId: params.runId,
        phase: params.phase,
        eventType: 'artifact_handoff',
        actor: { agentId: step.agentId },
        payload: {
          fromPosition: step.position,
          toPosition: step.position + 1,
          artifact: result,
        },
      });

      artifact = result as TArtifact;
    }

    return artifact;
  }

  private restoreArtifactFromSnapshot<TArtifact>(
    snapshot: GateSnapshot,
    originalInput: TArtifact,
  ): TArtifact {
    // The artifact at suspension is the enriched version — whatever the
    // gating agent had built before it fired. This becomes the input
    // passed back to the resuming agent.
    return snapshot.artifactAtSuspension as TArtifact;
  }

  private buildSnapshot(
    phase: Phase,
    firingPosition: number,
    artifactAtSuspension: unknown,
    pipeline: AgentStepConfig[],
    planArtifact: PlanArtifact | undefined,
    contextObject: ContextObject | undefined,
    priorSnapshot: GateSnapshot | undefined,
  ): GateSnapshot {
    const agentOutputsBeforeGate = pipeline
      .filter(s => s.position < firingPosition)
      .map(s => ({
        position: s.position,
        artifact: this.runRepository.getPersistedPipelineArtifact(s.position),
      }));

    const base = { pipelinePosition: firingPosition, artifactAtSuspension, agentOutputsBeforeGate };

    if (phase === 'ACQUIRE') {
      return base as GateASnapshot;
    }

    if (phase === 'PLAN') {
      return { ...base, contextObject } as GatePSnapshot;
    }

    // Gate E — includes ExecutionProgress so Execute knows what has already been done
    const executionProgress: ExecutionProgress = {
      completedSubTaskIds: this.runRepository.getCompletedSubTaskIds(planArtifact!.runId),
      modifiedFiles: this.runRepository.getModifiedFiles(planArtifact!.runId),
      verificationResultsSoFar: this.runRepository.getVerificationResults(planArtifact!.runId),
    };

    return { ...base, planArtifact, contextObject, executionProgress } as GateESnapshot;
  }
}
```

### 7.3 RuleEnforcementService

```typescript
@Injectable()
export class RuleEnforcementService {
  constructor(
    private readonly llmRegistry: LLMRegistryService,
    private readonly auditLogger: AuditLoggerService,
    private readonly harnessConfig: HarnessConfigService,
  ) {}

  async checkHardRules(params: {
    harnessId: string;
    runId: string;
    phase: Phase;
    actionType: string;
    description: string;
    targetPath?: string;
    planArtifact?: PlanArtifact;
    currentArtifact?: unknown;
  }): Promise<RuleCheckResult> {
    const rules = await this.harnessConfig.getHardRules(params.harnessId, params.phase);

    for (const rule of rules) {
      const violation = await this.evaluate(rule, params);
      if (violation) {
        return {
          violated: true,
          rule,
          gateQuestion: this.buildGateQuestion(rule, params, violation),
        };
      }
    }

    return { violated: false };
  }

  async checkSoftRules(params: {
    harnessId: string;
    runId: string;
    phase: Phase;
    agentId: string;
    description: string;
    outputArtifact: unknown;
    planArtifact?: PlanArtifact;
  }): Promise<void> {
    const rules = await this.harnessConfig.getSoftRules(params.harnessId, params.phase);

    for (const rule of rules) {
      const violation = await this.evaluate(rule, params);
      if (violation) {
        // Soft rule deviations are logged but never block execution
        await this.auditLogger.log({
          runId: params.runId,
          phase: params.phase,
          eventType: 'rule_deviation',
          actor: { type: 'agent', agentId: params.agentId },
          payload: {
            ruleId: rule.ruleId,
            ruleName: rule.name,
            enforcement: 'soft',
            deviation: violation,
          },
        });
      }
    }
  }

  private async evaluate(rule: Rule, params: RuleEvalParams): Promise<string | null> {
    // Deterministic path evaluation — no LLM call, fast
    if (rule.patternType === 'path' && params.targetPath) {
      const matches = rule.patterns.some(p => params.targetPath!.startsWith(p));
      if (matches) return `Target path ${params.targetPath} matches rule pattern`;
    }

    if (rule.patternType === 'regex' && params.targetPath) {
      const matches = rule.patterns.some(p => new RegExp(p).test(params.targetPath!));
      if (matches) return `Target path matches rule regex`;
    }

    // Semantic evaluation — Haiku-class model for rules that cannot be
    // evaluated by pattern matching (e.g. "Do not open PRs larger than 400 lines")
    if (rule.patternType === 'semantic') {
      const llm = this.llmRegistry.get('anthropic');
      const response = await llm.complete({
        model: 'claude-haiku-4-5',
        maxTokens: 50,
        system: 'You are a rule compliance evaluator. Respond with VIOLATION: <reason> or COMPLIANT.',
        messages: [{
          role: 'user',
          content: `
Rule: ${rule.constraint}
Planned action: ${params.description}
Context: ${JSON.stringify(params.planArtifact?.estimatedScope ?? {})}

Does this planned action violate the rule?
          `.trim(),
        }],
      });

      const text = response.text.trim();
      if (text.startsWith('VIOLATION:')) {
        return text.replace('VIOLATION:', '').trim();
      }
    }

    return null;
  }

  private buildGateQuestion(rule: Rule, params: RuleEvalParams, violation: string): string {
    return [
      `A hard rule was violated during ${params.actionType}.`,
      '',
      `Rule: "${rule.name}"`,
      `Constraint: ${rule.constraint}`,
      `Planned action: ${params.description}`,
      `Violation: ${violation}`,
      '',
      `How should the agent proceed? Provide guidance or confirm an exception.`,
    ].join('\n');
  }
}
```

### 7.4 AuditActivities

```typescript
@Injectable()
export class AuditActivities {
  constructor(
    private readonly auditLogger: AuditLoggerService,
    private readonly auditRepository: AuditRepository,
  ) {}

  // Called from inside the Temporal workflow on backward traversal.
  // Non-retryable in terms of side effects: idempotent via gateId dedup key
  // to prevent double-logging on Temporal replay.
  async logTraversalEvent(params: {
    runId: string;
    gateId: string;
    fromPhase: Phase;
    toPhase: Phase;
  }): Promise<void> {
    // Idempotent check — if Temporal replays the workflow, this prevents
    // the traversal event from appearing twice in the audit timeline
    const existing = await this.auditRepository.findByGateIdAndEventType(
      params.gateId,
      'gate_traversal_backward',
    );
    if (existing) return;

    await this.auditLogger.log({
      runId: params.runId,
      eventType: 'gate_traversal_backward',
      actor: { type: 'orchestrator' },
      payload: {
        gateId: params.gateId,
        fromPhase: params.fromPhase,
        toPhase: params.toPhase,
      },
    });
  }
}
```

---

## 8. Agent Architecture

### 8.1 Base Agent Pattern

Every agent service extends an abstract base class that enforces the agentic loop and locked preamble injection.

```typescript
export abstract class BaseAgent<TInput, TOutput> {
  constructor(
    protected readonly llmRegistry: LLMRegistryService,
    protected readonly auditLogger: AuditLoggerService,
  ) {}

  async run(input: TInput, context: AgentContext): Promise<TOutput | GateEvent> {
    const config = context.agentConfig;
    const llm = this.llmRegistry.get(config.llmConnectorId);

    // Locked preamble is framework-owned and injected server-side.
    // It is never stored as a user-editable field.
    const preamble = this.buildLockedPreamble();
    const skillsContent = config.skills.map(s => s.content).join('\n\n');
    const rulesContent = config.rules
      .map(r => `RULE [${r.enforcement.toUpperCase()}]: ${r.constraint}`)
      .join('\n');

    const systemPrompt = [preamble, config.systemPromptBody, skillsContent, rulesContent]
      .filter(Boolean)
      .join('\n\n---\n\n');

    const initialMessage = this.buildInitialMessage(input);
    const tools = this.buildToolSet(context);

    return this.runAgentLoop({ llm, systemPrompt, initialMessage, tools, input, context });
  }

  protected abstract buildLockedPreamble(): string;
  protected abstract buildInitialMessage(input: TInput): string;
  protected abstract buildToolSet(context: AgentContext): Tool[];
  protected abstract parseOutput(response: LLMResponse): TOutput;
  protected abstract executeToolCall(
    toolName: string,
    toolInput: unknown,
    context: AgentContext,
  ): Promise<unknown>;

  private async runAgentLoop(params: AgentLoopParams<TInput>): Promise<TOutput | GateEvent> {
    const messages: Message[] = [
      { role: 'user', content: params.initialMessage },
    ];

    while (true) {
      const response = await params.llm.complete({
        messages,
        system: params.systemPrompt,
        tools: params.tools,
        model: params.context.agentConfig.model,
        maxTokens: params.context.agentConfig.maxTokens ?? 4096,
      });

      await this.auditLogger.log({
        runId: params.context.runId,
        eventType: 'llm_call',
        actor: {
          agentId: params.context.agentConfig.agentId,
          llmProvider: params.context.agentConfig.llmProvider,
          model: params.context.agentConfig.model,
        },
        payload: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          stopReason: response.stopReason,
        },
      });

      messages.push({ role: 'assistant', content: response.content });

      if (response.stopReason === 'end_turn') {
        return this.parseOutput(response);
      }

      if (response.stopReason === 'tool_use') {
        const toolResultMessages: ToolResultMessage[] = [];

        for (const toolUse of response.toolUses) {
          // Intercept fire_gate before any connector call
          if (toolUse.name === 'fire_gate') {
            return new GateEvent({
              phase: params.context.phase,
              runId: params.context.runId,
              harnessId: params.context.harnessId,
              gapDescription: toolUse.input.gapDescription,
              question: toolUse.input.question,
              source: params.context.source,
              agentId: params.context.agentConfig.agentId,
              pipelinePosition: params.context.pipelinePosition,
              temporalWorkflowId: params.context.temporalWorkflowId,
              // Snapshot is attached by AgentDispatcherService after this returns
            });
          }

          const result = await this.executeToolCall(
            toolUse.name,
            toolUse.input,
            params.context,
          );

          await this.auditLogger.log({
            runId: params.context.runId,
            eventType: 'tool_call',
            actor: { agentId: params.context.agentConfig.agentId },
            payload: { toolName: toolUse.name, input: toolUse.input, result },
          });

          toolResultMessages.push({
            type: 'tool_result',
            toolUseId: toolUse.id,
            content: JSON.stringify(result),
          });
        }

        messages.push({ role: 'user', content: toolResultMessages });
      }
    }
  }
}
```

### 8.2 TriggerAgentService

```typescript
@Injectable()
export class TriggerAgentService {
  constructor(
    private readonly auditLogger: AuditLoggerService,
    private readonly runRepository: RunRepository,
  ) {}

  // Temporal activity — first phase of every run
  async runPhase(rawInput: RawTriggerInput): Promise<TaskDescriptor> {
    await this.runRepository.updatePhase(rawInput.runId, 'TRIGGER');

    await this.auditLogger.log({
      runId: rawInput.runId,
      harnessId: rawInput.harnessId,
      phase: 'TRIGGER',
      eventType: 'phase_started',
      actor: { agentId: 'trigger-agent' },
      payload: { rawInput },
    });

    // Normalize the raw input into a TaskDescriptor
    // No memory writes, no gate events, no state beyond the TaskDescriptor
    const taskDescriptor: TaskDescriptor = {
      taskId: uuidv4(),
      runId: rawInput.runId,
      harnessId: rawInput.harnessId,
      rawInput: rawInput.rawText,
      normalizedIntent: this.normalize(rawInput.rawText),
      source: rawInput.source,
    };

    await this.auditLogger.log({
      runId: rawInput.runId,
      harnessId: rawInput.harnessId,
      phase: 'TRIGGER',
      eventType: 'phase_completed',
      actor: { agentId: 'trigger-agent' },
      payload: { taskDescriptor },
    });

    return taskDescriptor;
  }

  private normalize(rawText: string): string {
    return rawText.replace(/^@finch\s+/i, '').trim();
  }
}
```

### 8.3 AcquireAgentService

```typescript
@Injectable()
export class AcquireAgentService {
  constructor(
    private readonly llmRegistry: LLMRegistryService,
    private readonly connectorRegistry: ConnectorRegistryService,
    private readonly memoryConnector: MemoryConnectorService,
    private readonly auditLogger: AuditLoggerService,
    private readonly dispatcher: AgentDispatcherService,
    private readonly gateController: GateControllerService,
  ) {}

  async runPhase(taskDescriptor: TaskDescriptor): Promise<ContextObject> {
    await this.auditLogger.log({
      runId: taskDescriptor.runId,
      phase: 'ACQUIRE',
      eventType: 'phase_started',
      actor: { type: 'orchestrator' },
      payload: {},
    });

    const memoryHits = await this.memoryConnector.query({
      harnessId: taskDescriptor.harnessId,
      query: taskDescriptor.normalizedIntent,
      limit: 10,
    });

    const seedArtifact = ContextObject.seed(taskDescriptor, memoryHits);

    const result = await this.dispatcher.runPhase({
      phase: 'ACQUIRE',
      inputArtifact: seedArtifact,
      runId: taskDescriptor.runId,
      harnessId: taskDescriptor.harnessId,
      source: taskDescriptor.source,
    });

    if (result instanceof GateEvent) {
      await this.gateController.dispatch(result);
      return seedArtifact.withGap(result);
    }

    await this.auditLogger.log({
      runId: taskDescriptor.runId,
      phase: 'ACQUIRE',
      eventType: 'phase_completed',
      actor: { type: 'orchestrator' },
      payload: {},
    });

    return result as ContextObject;
  }

  async resumePhase(
    contextObject: ContextObject,
    resolution: GateResolution,
  ): Promise<ContextObject> {
    const enriched = contextObject.withResolution(resolution);

    const result = await this.dispatcher.runPhase({
      phase: 'ACQUIRE',
      inputArtifact: enriched,
      runId: contextObject.runId,
      harnessId: contextObject.harnessId,
      resumeFromSnapshot: resolution.snapshot as GateASnapshot,
      source: contextObject.taskDescriptor.source,
    });

    if (result instanceof GateEvent) {
      await this.gateController.dispatch(result);
      return enriched.withGap(result);
    }

    return result as ContextObject;
  }
}
```

### 8.4 PlanAgentService

```typescript
@Injectable()
export class PlanAgentService {
  async runPhase(contextObject: ContextObject): Promise<PlanArtifact> {
    await this.auditLogger.log({
      runId: contextObject.runId,
      phase: 'PLAN',
      eventType: 'phase_started',
      actor: { type: 'orchestrator' },
      payload: {},
    });

    const result = await this.dispatcher.runPhase({
      phase: 'PLAN',
      inputArtifact: PlanArtifact.seed(contextObject),
      runId: contextObject.runId,
      harnessId: contextObject.harnessId,
      contextObject,
      source: contextObject.taskDescriptor.source,
    });

    if (result instanceof GateEvent) {
      await this.gateController.dispatch(result);
      return PlanArtifact.seed(contextObject).withGap(result);
    }

    await this.auditLogger.log({
      runId: contextObject.runId,
      phase: 'PLAN',
      eventType: 'phase_completed',
      actor: { type: 'orchestrator' },
      payload: {},
    });

    return result as PlanArtifact;
  }

  async resumePhase(
    planArtifact: PlanArtifact,
    resolution: GateResolution,
  ): Promise<PlanArtifact> {
    const snapshot = resolution.snapshot as GatePSnapshot;
    const enriched = planArtifact.withResolution(resolution);

    const result = await this.dispatcher.runPhase({
      phase: 'PLAN',
      inputArtifact: enriched,
      runId: planArtifact.runId,
      harnessId: planArtifact.harnessId,
      contextObject: snapshot.contextObject,
      resumeFromSnapshot: snapshot,
      source: snapshot.contextObject.taskDescriptor.source,
    });

    if (result instanceof GateEvent) {
      await this.gateController.dispatch(result);
      return enriched.withGap(result);
    }

    return result as PlanArtifact;
  }
}
```

### 8.5 ExecuteAgentService

The ExecuteAgent retains the `check_rule_compliance` tool for intra-execution hard rule checks that only become evaluable mid-execution (e.g. file path violations discovered while writing). Phase-boundary hard rules are handled by the dispatcher before the agent runs.

```typescript
@Injectable()
export class ExecuteAgentService extends BaseAgent<ExecuteInput, VerificationReport> {

  protected buildLockedPreamble(): string {
    return `
You are the Execute agent in the TAPES framework. Your responsibility is to implement
the work defined in the PlanArtifact exactly as specified.

SCOPE ENFORCEMENT — NON-NEGOTIABLE:
Before every file operation, verify the target path is not in scope_boundaries.excluded_paths.
Before every behavioral change, verify it is not in scope_boundaries.excluded_behaviors.
If a target is in scope_boundaries, call fire_gate — do NOT skip or work around it.

Use check_rule_compliance before any file write, behavioral change, or PR operation
to detect hard rule violations that are only evaluable mid-execution.
If check_rule_compliance returns violated: true, call fire_gate immediately
with the provided gate question — which includes the rule constraint verbatim.

PLAN AS CONTRACT:
You may not change approach, expand scope, or modify unrelated files.
If the plan is wrong or incomplete mid-execution, call fire_gate.
The plan is revised through the gate — never silently.

GATE CONDITION:
Call fire_gate only when you have a specific, unresolvable context gap mid-execution.
A flaky test is a technical issue — retry it. Ambiguous expected behavior is a context gap — fire a gate.

SUB-TASK ORDER:
Execute sub-tasks in the exact order specified. Reordering requires re-entering Plan.

OUTPUT CONTRACT:
Produce a VerificationReport confirming all verification_conditions are met.
${VerificationReport.jsonSchemaAsString()}
    `.trim();
  }

  protected buildToolSet(context: AgentContext): Tool[] {
    return [
      fireGateTool,
      // Intra-execution hard rule check — for violations only evaluable mid-execution
      checkRuleComplianceTool(this.ruleEnforcementService, context),
      githubWriteFileTool(this.connectorRegistry.getExecuteConnector(context.harnessId)),
      githubRunCommandTool(this.connectorRegistry.getExecuteConnector(context.harnessId)),
      memoryWriteTool(this.memoryConnector, context),
    ];
  }

  protected async executeToolCall(
    toolName: string,
    toolInput: unknown,
    context: AgentContext,
  ): Promise<unknown> {
    // Enforce scope boundaries before any file write
    if (toolName === 'github_write_file') {
      const { path } = toolInput as { path: string };
      const plan = context.planArtifact!;

      if (plan.scopeBoundaries.excludedPaths.some(ep => path.startsWith(ep))) {
        throw new ScopeViolationError(
          `Path ${path} is in scope_boundaries.excluded_paths. Call fire_gate if this path must be modified.`,
        );
      }
    }

    return super.executeToolCall(toolName, toolInput, context);
  }
}
```

### 8.6 ShipAgentService

The ShipAgent writes to memory staging only. Memory merge is handled by the orchestration layer as a separate Temporal activity after Ship completes.

```typescript
@Injectable()
export class ShipAgentService {
  constructor(
    private readonly dispatcher: AgentDispatcherService,
    private readonly connectorRegistry: ConnectorRegistryService,
    private readonly memoryConnector: MemoryConnectorService,
    private readonly auditLogger: AuditLoggerService,
    private readonly runRepository: RunRepository,
  ) {}

  // Temporal activity — handles exactly one repository
  async runPhase(
    planArtifact: PlanArtifact,
    verificationReport: VerificationReport,
    contextObject: ContextObject,
    repoId: string,
  ): Promise<ShipResult> {
    await this.auditLogger.log({
      runId: planArtifact.runId,
      phase: 'SHIP',
      eventType: 'phase_started',
      actor: { type: 'orchestrator' },
      payload: { repoId },
    });

    const result = await this.dispatcher.runPhase({
      phase: 'SHIP',
      inputArtifact: { planArtifact, verificationReport, contextObject, repoId },
      runId: planArtifact.runId,
      harnessId: planArtifact.harnessId,
      planArtifact,
      contextObject,
      source: contextObject.taskDescriptor.source,
    });

    const shipResult = result as ShipResult;

    // ShipAgent writes its learnings to the staging area.
    // The actual merge into the main memory store is the orchestration core's
    // responsibility — done via the mergeRunMemory Temporal activity
    // called after all Ship activities complete. ShipAgent does not merge.
    await this.memoryConnector.writeToStaging({
      runId: planArtifact.runId,
      harnessId: planArtifact.harnessId,
      type: 'TaskPattern',
      content: this.buildMemoryUpdate(planArtifact, verificationReport, contextObject),
      relevanceTags: planArtifact.affectedComponents,
      agentId: 'ship-agent',
    });

    // Notify trigger source
    const triggerConnector = this.connectorRegistry.getTriggerConnector(planArtifact.harnessId);
    await triggerConnector.sendMessage({
      channelId: contextObject.taskDescriptor.source.channelId,
      threadTs: contextObject.taskDescriptor.source.threadTs,
      message: this.formatShipNotification(shipResult, repoId),
    });

    await this.auditLogger.log({
      runId: planArtifact.runId,
      phase: 'SHIP',
      eventType: 'phase_completed',
      actor: { type: 'orchestrator' },
      payload: { repoId, prUrl: shipResult.prUrl },
    });

    return shipResult;
  }

  // Called by the workflow to aggregate results across all repos
  async aggregateResults(runId: string, results: ShipOutcome[]): Promise<void> {
    for (const outcome of results) {
      if (outcome.status === 'failed') {
        await this.auditLogger.log({
          runId,
          phase: 'SHIP',
          eventType: 'ship_failed',
          actor: { type: 'orchestrator' },
          payload: { repoId: outcome.repoId, error: outcome.error },
        });
      } else {
        await this.auditLogger.log({
          runId,
          phase: 'SHIP',
          eventType: 'ship_completed',
          actor: { type: 'orchestrator' },
          payload: { repoId: outcome.repoId, prUrl: outcome.result.prUrl },
        });
      }
    }

    // Run is COMPLETED when all Ship activities have resolved —
    // success or logged failure. Individual Ship failures do not block completion.
    await this.runRepository.updateStatus(runId, 'COMPLETED');

    await this.auditLogger.log({
      runId,
      phase: 'SHIP',
      eventType: 'run_completed',
      actor: { type: 'orchestrator' },
      payload: { outcomes: results },
    });
  }

  private buildMemoryUpdate(
    planArtifact: PlanArtifact,
    verificationReport: VerificationReport,
    contextObject: ContextObject,
  ): string {
    return [
      `Task: ${contextObject.taskDescriptor.normalizedIntent}`,
      `Approach: ${planArtifact.proposedApproach}`,
      `Files modified: ${verificationReport.modifiedFiles.map(f => f.path).join(', ')}`,
      `Components: ${planArtifact.affectedComponents.join(', ')}`,
    ].join('\n');
  }
}
```

---

## 9. Multi-Agent Pipelines

### 9.1 Pipeline Configuration Schema

```typescript
interface AgentPipelineConfig {
  phase: Phase;
  harnessId: string;
  agents: AgentStepConfig[];
}

interface AgentStepConfig {
  agentId: string;
  position: number;             // zero-based
  llmConnectorId: string;
  llmProvider: string;
  model: string;
  maxTokens: number;
  systemPromptBody: string;     // user-editable; locked preamble added server-side
  skills: Skill[];
  rules: Rule[];
}
```

### 9.2 Pipeline Execution Semantics

**Artifact invariance.** The artifact type is invariant within a pipeline. All ACQUIRE agents receive and produce `ContextObject`. All PLAN agents receive and produce `PlanArtifact`. An agent built for a phase is pipeline-compatible without modification.

**Sequential execution.** Agents execute in position order. Each agent receives the artifact enriched by all prior agents in the pipeline.

**Point-of-suspension resume (FC-10).** When a gate fires at position N, agents at positions 0 through N-1 are not re-run on resume. Their outputs are preserved in the typed gate snapshot and restored by the dispatcher. The agent at position N re-runs from its entry point with the enriched artifact (snapshot artifact plus gate resolution injected). This is the only supported resume model — LLM conversation history restoration is not implemented.

**Hard rule checks at phase boundary.** Before invoking each agent, the dispatcher evaluates all hard rules applicable to the current phase. A violation fires a gate with the rule constraint included in the question.

**Soft rule checks post-agent.** After each agent produces output, the dispatcher evaluates soft rules. Violations are logged as `rule_deviation` audit events but do not block the pipeline.

**Gate fires at the phase level.** Any agent in the pipeline can fire a gate. The pipeline stops at that position. The human sees one coherent question regardless of which agent in the pipeline fired it.

**Crash recovery.** The dispatcher persists `pipeline_position` and `pipeline_artifact` before invoking each agent. On Temporal replay after a server crash, the dispatcher reads the persisted position and resumes from there. The single `pipeline_artifact` column stores the artifact at the last completed position — this is sufficient because each agent's output is the next agent's input.

---

## 10. Agent-to-Agent Communication Model

### 10.1 The Fundamental Rule

Agents do not communicate directly with each other. No agent holds a reference to another agent. No agent calls another agent's methods. No agent sends messages to another agent. This applies within a phase pipeline and across phases.

This constraint exists for three reasons. First, auditability — direct agent calls would be invisible to the audit log and impossible to replay. Second, resumability — direct calls create dependencies that cannot be cleanly serialized and restored after a gate firing. Third, testability — agents that communicate through shared artifacts are independently testable.

### 10.2 Within a Phase: Artifact as Communication

Within a pipeline, agents communicate only through the canonical phase artifact. Agent N receives the artifact built by all prior agents, enriches it, and returns it. The dispatcher passes it to Agent N+1.

### 10.3 Across Phases: Artifacts via the Workflow

Across phases, the Temporal workflow function passes artifacts as activity arguments. The workflow receives the output of ACQUIRE (a `ContextObject`) and passes it to PLAN. PLAN receives `ContextObject` and produces `PlanArtifact`. EXECUTE receives both. SHIP receives all three plus a `repoId`. No agent knows about any other phase's agent.

### 10.4 Across Runs: Memory as Coordination

The only coordination mechanism between agents across different runs is the memory system. A ShipAgent in run N writes MemoryRecords to staging. The `mergeRunMemory` activity (orchestration layer, not the agent) merges them into the main store. An AcquireAgent in run N+1 reads the accumulated knowledge. This is the incremental trust mechanism.

---

## 11. Clarification Gate Protocol

### 11.1 Typed Gate Snapshot Schemas

```typescript
interface GateASnapshot {
  pipelinePosition: number;
  artifactAtSuspension: ContextObject;
  agentOutputsBeforeGate: { position: number; artifact: ContextObject }[];
}

interface GatePSnapshot {
  pipelinePosition: number;
  artifactAtSuspension: PlanArtifact;
  agentOutputsBeforeGate: { position: number; artifact: PlanArtifact }[];
  contextObject: ContextObject;
}

interface GateESnapshot {
  pipelinePosition: number;
  artifactAtSuspension: VerificationReport;
  agentOutputsBeforeGate: { position: number; artifact: VerificationReport }[];
  executionProgress: ExecutionProgress;
  planArtifact: PlanArtifact;
  contextObject: ContextObject;
}

interface ExecutionProgress {
  completedSubTaskIds: string[];
  modifiedFiles: ModifiedFile[];
  verificationResultsSoFar: VerificationResult[];
}

type GateSnapshot = GateASnapshot | GatePSnapshot | GateESnapshot;
```

### 11.2 GateEvent Interface

```typescript
interface GateEvent {
  gateId: string;
  runId: string;
  harnessId: string;
  phase: 'ACQUIRE' | 'PLAN' | 'EXECUTE';
  firedAt: Date;
  gapDescription: string;
  question: string;
  source: TriggerSource;
  agentId: string;
  pipelinePosition: number;
  snapshot: GateSnapshot;           // typed per gate phase — replaces artifactSnapshot: string
  temporalWorkflowId: string;
  timeoutMs: number;
}
```

### 11.3 The fire_gate Tool

```typescript
const fireGateTool: Tool = {
  name: 'fire_gate',
  description: `
    Fire a clarification gate when you have identified a specific context gap you cannot
    resolve from available sources, and proceeding without resolving it would risk producing
    incorrect or unsafe output.

    Do NOT use this tool to seek approval, express general uncertainty, or flag complexity.
    Use this tool only when you have a specific, named, unresolvable information gap.
  `,
  inputSchema: {
    type: 'object',
    properties: {
      gapDescription: {
        type: 'string',
        description: 'A precise description of what specific information is missing and why it cannot be obtained from available sources.',
      },
      question: {
        type: 'string',
        description: 'The specific, minimal question for the human. Must identify the exact missing information. Must not be open-ended.',
      },
    },
    required: ['gapDescription', 'question'],
  },
};
```

### 11.4 Gate Lifecycle State Machine

```
RUNNING
  ↓ agent calls fire_gate OR hard rule violation detected by dispatcher
GATE_DISPATCHING
  ↓ typed snapshot built and persisted
  ↓ question sent to trigger channel (with rule constraint if rule-triggered)
  ↓ timeout job scheduled
WAITING_FOR_HUMAN
  ↓ human responds in thread
  ↓ GateControllerService.resolve() called
EVALUATING_TRAVERSAL
  ↓ traversal decision made (Gate A: always ACQUIRE; Gate P/E: Haiku classification)
  ↓ resolution with snapshot passed back to Temporal workflow
RESUMING
  ↓ logTraversalEvent activity called (idempotent via gateId)
  ↓ activity re-invoked with resumeFromSnapshot
  ↓ dispatcher skips prior positions, restores artifacts, resumes at firing position
RUNNING
```

### 11.5 Slack Gate Response Routing

The Slack connector distinguishes gate responses from new trigger messages by matching `thread_ts` against open gate events.

```typescript
this.app.event('message', async ({ event }) => {
  if (!event.thread_ts) return;

  const openGate = await this.gateRepository.findOpenGateByThread({
    channelId: event.channel,
    threadTs: event.thread_ts,
  });

  if (openGate) {
    await this.gateController.resolve(openGate.gateId, event.text);
    return;
  }
  // Not a gate response — handled by trigger logic elsewhere
});
```

### 11.6 Gate Timeout Handling

```typescript
@Processor('gate-timeout')
export class GateTimeoutProcessor {
  @Process('gate-timeout')
  async handle(job: Job<{ gateId: string; runId: string }>) {
    const gate = await this.gateRepository.findById(job.data.gateId);
    if (gate.resolvedAt) return;

    await this.runRepository.updateStatus(job.data.runId, 'STALLED');

    const triggerConnector = this.connectorRegistry.getTriggerConnector(gate.harnessId);
    await triggerConnector.sendMessage({
      channelId: gate.source.channelId,
      threadTs: gate.source.threadTs,
      message: `*Reminder — Finch is waiting for your response* (Run: \`${gate.runId}\`)\n\n${gate.question}`,
    });

    await this.bullQueue.add(
      'gate-timeout',
      { gateId: gate.gateId, runId: gate.runId },
      { delay: 24 * 60 * 60 * 1000, jobId: `gate-timeout:${gate.gateId}:retry` },
    );

    await this.auditLogger.log({
      runId: gate.runId,
      eventType: 'gate_stalled',
      payload: { gateId: gate.gateId },
    });
  }
}
```

---

## 12. Memory System

### 12.1 MemoryRecord Schema

```typescript
interface MemoryRecord {
  memoryId: string;
  harnessId: string;
  createdAt: Date;
  updatedAt: Date;
  sourceRunId: string;
  type: MemoryType;
  content: string;
  embedding: number[];           // 1536-dimension vector
  relevanceTags: string[];
  contentHash: string;           // SHA-256 for deduplication
}

type MemoryType =
  | 'TaskPattern'
  | 'FileConvention'
  | 'TeamConvention'
  | 'GatePattern'
  | 'RiskSignal'
  | 'RepoMap';
```

### 12.2 MemoryActivities — Orchestration Core Responsibility

Memory merge is owned by the orchestration layer. It is a Temporal activity called by the workflow after all Ship activities complete. It is not called from inside any agent.

```typescript
@Injectable()
export class MemoryActivities {
  constructor(
    private readonly memoryConnector: MemoryConnectorService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  async mergeRunMemory(runId: string): Promise<void> {
    const staging = await this.memoryConnector.getStagingRecords(runId);

    for (const record of staging) {
      await this.memoryConnector.mergeRecord(record);
    }

    await this.memoryConnector.clearStaging(runId);

    // Emit memory_merged audit event
    await this.auditLogger.log({
      runId,
      eventType: 'memory_merged',
      actor: { type: 'orchestrator' },
      payload: { recordCount: staging.length },
    });
  }
}
```

### 12.3 MemoryConnectorService

```typescript
@Injectable()
export class MemoryConnectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  async query(params: {
    harnessId: string;
    query: string;
    limit?: number;
    types?: MemoryType[];
    minRelevanceScore?: number;
  }): Promise<MemoryHit[]> {
    const queryEmbedding = await this.embedding.embed(params.query);
    const embeddingLiteral = `[${queryEmbedding.join(',')}]`;
    const minScore = params.minRelevanceScore ?? 0.7;

    const results = await this.prisma.$queryRaw<(MemoryRecord & { relevance_score: number })[]>`
      SELECT *,
             1 - (embedding <=> ${embeddingLiteral}::vector) AS relevance_score
      FROM memory_records
      WHERE harness_id = ${params.harnessId}
        AND (${params.types ?? null}::text[] IS NULL
             OR type = ANY(${params.types ?? []}::memory_type[]))
        AND 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${minScore}
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${params.limit ?? 10}
    `;

    return results.map(r => ({
      memoryId: r.memoryId,
      type: r.type,
      content: r.content,
      relevanceScore: r.relevance_score,
      sourceRunId: r.sourceRunId,
      relevanceTags: r.relevanceTags,
    }));
  }

  async writeToStaging(params: {
    runId: string;
    harnessId: string;
    type: MemoryType;
    content: string;
    relevanceTags: string[];
    agentId: string;
  }): Promise<void> {
    const embedding = await this.embedding.embed(params.content);
    const contentHash = createHash('sha256').update(params.content).digest('hex');

    await this.prisma.memoryStaging.create({
      data: {
        runId: params.runId,
        harnessId: params.harnessId,
        type: params.type,
        content: params.content,
        embedding,
        relevanceTags: params.relevanceTags,
        contentHash,
        createdAt: new Date(),
      },
    });

    // Emit memory_staged audit event
    await this.auditLogger.log({
      runId: params.runId,
      eventType: 'memory_staged',
      actor: { type: 'agent', agentId: params.agentId },
      payload: { type: params.type, contentHash, relevanceTags: params.relevanceTags },
    });
  }

  async mergeRecord(record: MemoryStagingRecord): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO memory_records
        (memory_id, harness_id, type, content, embedding, source_run_id,
         relevance_tags, content_hash, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${record.harnessId}, ${record.type}::memory_type,
         ${record.content}, ${`[${record.embedding.join(',')}]`}::vector,
         ${record.runId}, ${record.relevanceTags}, ${record.contentHash}, NOW(), NOW())
      ON CONFLICT (harness_id, content_hash)
      DO UPDATE SET
        content       = EXCLUDED.content,
        embedding     = EXCLUDED.embedding,
        updated_at    = NOW(),
        source_run_id = EXCLUDED.source_run_id
    `;
  }

  async getStagingRecords(runId: string): Promise<MemoryStagingRecord[]> {
    return this.prisma.memoryStaging.findMany({ where: { runId } });
  }

  async clearStaging(runId: string): Promise<void> {
    await this.prisma.memoryStaging.deleteMany({ where: { runId } });
  }
}
```

### 12.4 Memory Presentation to Agents

Memory hits are formatted as a structured block prepended to the agent's initial user message:

```
--- Memory context (from prior runs) ---

[TaskPattern | relevance: 0.94 | run: abc-123]
For tasks involving the payments module, always check legacy_stripe_wrapper.ts.
It contains undocumented overrides that conflict with the main Stripe SDK behavior.
Tags: payments, stripe, legacy

[GatePattern | relevance: 0.91 | run: def-456]
Gate A fired on auth tasks due to missing OAuth client config.
Resolution: config lives in Vault under /secrets/oauth/clients.
Tags: auth, oauth, vault

[TeamConvention | relevance: 0.87 | run: ghi-789]
PRs must not exceed 400 lines. Security team review required for any change in /src/auth.
Tags: pr-conventions, auth, security

--- End memory context ---
```

As memory accumulates, conventions and prior resolutions pre-empt gate firings. This is the mechanism behind incremental trust.

---

## 13. Connector System

### 13.1 Abstract Interfaces

```typescript
interface TriggerConnector {
  sendMessage(params: { channelId: string; threadTs: string; message: string }): Promise<void>;
  extractRawInput(rawEvent: unknown): RawTriggerInput;
}

interface AcquireConnector {
  query(params: { query: string; context: ContextObject }): Promise<ContextSource>;
}

interface ExecuteConnector {
  cloneRepo(params: { repoId: string; branch: string }): Promise<WorkspaceHandle>;
  writeFile(params: { workspace: WorkspaceHandle; path: string; content: string }): Promise<void>;
  runCommand(params: { workspace: WorkspaceHandle; command: string; timeout: number; conditionId: string; runId: string }): Promise<CommandResult>;
  pushBranch(params: { workspace: WorkspaceHandle }): Promise<void>;
  cleanup(workspace: WorkspaceHandle): Promise<void>;
}

interface ShipConnector {
  openPullRequest(params: PullRequestParams): Promise<PullRequestResult>;
}

interface LLMConnector {
  complete(params: LLMCompleteParams): Promise<LLMResponse>;
}
```

### 13.2 ConnectorRegistryService

```typescript
@Injectable()
export class ConnectorRegistryService {
  private readonly connectors = new Map<string, Map<string, unknown>>();

  register(category: ConnectorCategory, id: string, connector: unknown): void {
    if (!this.connectors.has(category)) {
      this.connectors.set(category, new Map());
    }
    this.connectors.get(category)!.set(id, connector);
  }

  getTriggerConnector(harnessId: string): TriggerConnector {
    const config = this.harnessConfig.getActiveConnector(harnessId, 'trigger');
    return this.connectors.get('trigger')!.get(config.connectorId) as TriggerConnector;
  }

  getAcquireConnectors(harnessId: string): AcquireConnector[] {
    const configs = this.harnessConfig.getActiveConnectors(harnessId, 'acquire');
    return configs.map(c => this.connectors.get('acquire')!.get(c.connectorId) as AcquireConnector);
  }

  getExecuteConnector(harnessId: string, repoId?: string): ExecuteConnector {
    const config = this.harnessConfig.getExecuteConnector(harnessId, repoId);
    return this.connectors.get('execute')!.get(config.connectorId) as ExecuteConnector;
  }
}
```

Connectors self-register in `onModuleInit`:

```typescript
@Injectable()
export class SlackConnectorService implements TriggerConnector, OnModuleInit {
  constructor(private readonly registry: ConnectorRegistryService) {}

  async onModuleInit() {
    this.registry.register('trigger', 'slack', this);
    await this.initializeBoltApp();
  }
}
```

### 13.3 Slack Connector

The Slack connector extracts `RawTriggerInput` and passes it to the workflow starter. It does not normalize intent — that is the TriggerAgent's responsibility inside the workflow.

```typescript
@Injectable()
export class SlackConnectorService implements TriggerConnector, OnModuleInit {
  private app: App;

  async onModuleInit() {
    this.app = new App({
      token: this.config.get('SLACK_BOT_TOKEN'),
      signingSecret: this.config.get('SLACK_SIGNING_SECRET'),
    });

    this.app.event('message', async ({ event }) => {
      if (event.subtype) return;
      if (!event.text?.startsWith(this.config.get('TRIGGER_PREFIX') ?? '@finch')) return;

      if (event.thread_ts) {
        const openGate = await this.gateRepository.findOpenGateByThread({
          channelId: event.channel,
          threadTs: event.thread_ts,
        });
        if (openGate) {
          await this.gateController.resolve(openGate.gateId, event.text);
          return;
        }
      }

      const rawInput = this.extractRawInput(event);
      await this.workflowStarter.start(rawInput);
    });

    await this.app.start();
    this.registry.register('trigger', 'slack', this);
  }

  extractRawInput(rawEvent: unknown): RawTriggerInput {
    const event = rawEvent as SlackMessageEvent;
    return {
      rawText: event.text,
      source: {
        type: 'slack',
        channelId: event.channel,
        messageId: event.ts,
        threadTs: event.ts,
        authorId: event.user,
        timestamp: new Date(Number(event.ts) * 1000),
      },
      harnessId: this.config.get('HARNESS_ID'),
      runId: uuidv4(),
    };
  }

  async sendMessage(params: { channelId: string; threadTs: string; message: string }): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: params.channelId,
      thread_ts: params.threadTs,
      text: params.message,
    });
  }
}
```

### 13.4 GitHub Execute Connector

The `runCommand` method emits `verification_run` and `verification_result` audit events for every verification condition execution.

```typescript
async runCommand(params: {
  workspace: WorkspaceHandle;
  command: string;
  timeout: number;
  conditionId: string;
  runId: string;
}): Promise<CommandResult> {
  await this.auditLogger.log({
    runId: params.runId,
    phase: 'EXECUTE',
    eventType: 'verification_run',
    actor: { type: 'connector', connectorId: 'github-execute' },
    payload: { conditionId: params.conditionId, command: params.command },
  });

  const result = await this.executeCommand(params);

  await this.auditLogger.log({
    runId: params.runId,
    phase: 'EXECUTE',
    eventType: 'verification_result',
    actor: { type: 'connector', connectorId: 'github-execute' },
    payload: {
      conditionId: params.conditionId,
      passed: result.success,
      exitCode: result.exitCode,
      output: result.stdout,
    },
  });

  return result;
}

private executeCommand(params: RunCommandParams): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', params.command], {
      cwd: params.workspace.path,
      timeout: params.timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr, success: code === 0 });
    });
  });
}
```

### 13.5 LLM Connector Interface

```typescript
interface LLMCompleteParams {
  messages: Message[];
  system: string;
  tools?: Tool[];
  model: string;
  maxTokens: number;
  temperature?: number;
}

interface LLMResponse {
  content: ContentBlock[];
  toolUses: ToolUse[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

@Injectable()
export class AnthropicConnectorService implements LLMConnector, OnModuleInit {
  private client: Anthropic;

  onModuleInit() {
    this.client = new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY') });
    this.registry.register('llm', 'anthropic', this);
  }

  async complete(params: LLMCompleteParams): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages,
      tools: params.tools?.map(this.mapTool),
      temperature: params.temperature,
    });

    return {
      content: response.content,
      toolUses: response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, input: b.input })),
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
      text: response.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
```

---

## 14. Artifact Schemas

### 14.1 RawTriggerInput

```typescript
interface RawTriggerInput {
  rawText: string;
  source: {
    type: 'slack' | 'webhook' | 'cron';
    channelId: string;
    messageId: string;
    threadTs: string;
    authorId?: string;
    timestamp: Date;
  };
  harnessId: string;
  runId: string;
}
```

### 14.2 TaskDescriptor

```typescript
interface TaskDescriptor {
  taskId: string;
  runId: string;
  harnessId: string;
  rawInput: string;
  normalizedIntent: string;
  source: TriggerSource;
}
```

### 14.3 ContextObject

```typescript
interface ContextObject {
  contextId: string;
  runId: string;
  harnessId: string;
  taskDescriptor: TaskDescriptor;
  sources: ContextSource[];
  memoryHits: MemoryHit[];
  dimensions: {
    requirementsClarity:  DimensionStatus;
    technicalConstraints: DimensionStatus;
    affectedComponents:   DimensionStatus;
    riskSignals:          DimensionStatus;
    teamConventions:      DimensionStatus;
    repoRouting:          DimensionStatus;
  };
  sufficiencyAssessment: boolean;
  gaps: ContextGap[];
  repoMap?: RepoMap;
  hasGap: boolean;
  gatePayload?: GatePayload;
  version: number;
}
```

### 14.4 PlanArtifact

```typescript
interface PlanArtifact {
  planId: string;
  runId: string;
  harnessId: string;
  version: number;
  createdAt: Date;
  subTasks: SubTask[];
  affectedComponents: string[];
  riskAssessment: {
    riskLevel: 'low' | 'medium' | 'high';
    identifiedRisks: { description: string; mitigation: string }[];
  };
  estimatedScope: {
    filesToModify: string[];
    estimatedComplexity: 'small' | 'medium' | 'large';
  };
  proposedApproach: string;
  scopeBoundaries: {
    excludedPaths: string[];
    excludedBehaviors: string[];
    rationale: string;
  };
  verificationConditions: VerificationCondition[];
  hasGap: boolean;
  gatePayload?: GatePayload;
}

interface SubTask {
  id: string;
  description: string;
  affectedFiles: string[];
  repoId?: string;
  approach: string;
  order: number;
}

interface VerificationCondition {
  id: string;
  type: 'test' | 'lint' | 'build' | 'typecheck' | 'custom';
  description: string;
  command: string;
  assertion: string;
}
```

### 14.5 VerificationReport

```typescript
interface VerificationReport {
  reportId: string;
  runId: string;
  planId: string;
  completedAt: Date;
  subTaskResults: SubTaskResult[];
  verificationResults: VerificationResult[];
  allPassing: boolean;
  modifiedFiles: ModifiedFile[];
  hasGap: boolean;
  gatePayload?: GatePayload;
}

interface VerificationResult {
  conditionId: string;
  passed: boolean;
  output: string;
  exitCode: number;
  executedAt: Date;
}

interface ModifiedFile {
  path: string;
  repoId: string;
  operation: 'created' | 'modified' | 'deleted';
  beforeHash: string;
  afterHash: string;
  diff: string;
  subTaskId: string;
}
```

### 14.6 ExecutionProgress

```typescript
// Captured in GateESnapshot to preserve work done before a Gate E firing.
// On resume, ExecuteAgent reads this to know which sub-tasks are complete
// and which files have already been modified — preventing duplicate work.
interface ExecutionProgress {
  completedSubTaskIds: string[];
  modifiedFiles: ModifiedFile[];
  verificationResultsSoFar: VerificationResult[];
}
```

---

## 15. Database Design

### 15.1 PostgreSQL Schema

```sql
-- Harnesses
CREATE TABLE harnesses (
  harness_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  config       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Runs
-- pipeline_position and pipeline_artifact support intra-phase crash recovery.
-- pipeline_artifact stores the artifact at the LAST COMPLETED pipeline position.
-- This is intentional and sufficient: crash recovery only needs the artifact at
-- startPosition - 1, not a per-position store. See AgentDispatcherService for details.
CREATE TABLE runs (
  run_id                UUID PRIMARY KEY,
  harness_id            UUID NOT NULL REFERENCES harnesses(harness_id),
  temporal_workflow_id  TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN (
                          'RUNNING','WAITING_FOR_HUMAN','STALLED','COMPLETED','FAILED'
                        )),
  current_phase         TEXT NOT NULL CHECK (current_phase IN (
                          'TRIGGER','ACQUIRE','PLAN','EXECUTE','SHIP'
                        )),
  pipeline_position     INT,           -- position within current phase pipeline
  pipeline_artifact     JSONB,         -- artifact at pipeline_position - 1 (last completed)
  failure_reason        TEXT,
  failure_detail        TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX runs_harness_status   ON runs(harness_id, status);
CREATE INDEX runs_harness_started  ON runs(harness_id, started_at DESC);
CREATE INDEX runs_harness_phase    ON runs(harness_id, current_phase);

-- Phase Artifacts
CREATE TABLE phase_artifacts (
  artifact_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES runs(run_id),
  phase         TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  content       JSONB NOT NULL,
  version       INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX phase_artifacts_run_phase ON phase_artifacts(run_id, phase);

-- Gate Events
-- snapshot is a typed JSONB field — GateASnapshot, GatePSnapshot, or GateESnapshot
-- depending on the phase. Includes pipeline position and prior agent outputs.
CREATE TABLE gate_events (
  gate_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL REFERENCES runs(run_id),
  harness_id            UUID NOT NULL REFERENCES harnesses(harness_id),
  phase                 TEXT NOT NULL,
  agent_id              TEXT NOT NULL,
  pipeline_position     INT NOT NULL,
  fired_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gap_description       TEXT NOT NULL,
  question              TEXT NOT NULL,
  source                JSONB NOT NULL,
  snapshot              JSONB NOT NULL,   -- typed per phase; replaces artifactSnapshot
  temporal_workflow_id  TEXT NOT NULL,
  timeout_ms            BIGINT NOT NULL DEFAULT 172800000,
  resolved_at           TIMESTAMPTZ,
  resolution            JSONB
);

CREATE INDEX gate_events_run ON gate_events(run_id);
CREATE INDEX gate_events_open_thread
  ON gate_events((source->>'channelId'), (source->>'threadTs'), resolved_at)
  WHERE resolved_at IS NULL;

-- Audit Log (append-only, enforced at DB layer)
CREATE TABLE audit_events (
  event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID,
  harness_id  UUID,
  phase       TEXT,
  event_type  TEXT NOT NULL,
  actor       JSONB NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_events_run     ON audit_events(run_id, created_at);
CREATE INDEX audit_events_harness ON audit_events(harness_id, created_at DESC);

-- Immutability enforced at DB layer
CREATE RULE no_audit_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE no_audit_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;

-- Connectors
CREATE TABLE connectors (
  connector_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harness_id        UUID NOT NULL REFERENCES harnesses(harness_id),
  connector_type    TEXT NOT NULL,
  category          TEXT NOT NULL,
  config_encrypted  TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent Configurations
-- applicable_phases on rules enables phase-aware rule filtering in RuleEnforcementService
CREATE TABLE agent_configs (
  agent_config_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harness_id         UUID NOT NULL REFERENCES harnesses(harness_id),
  phase              TEXT NOT NULL,
  position           INT NOT NULL,
  agent_id           TEXT NOT NULL,
  llm_connector_id   TEXT NOT NULL,
  model              TEXT NOT NULL,
  max_tokens         INT NOT NULL DEFAULT 4096,
  system_prompt_body TEXT NOT NULL DEFAULT '',
  skills             JSONB NOT NULL DEFAULT '[]',
  rules              JSONB NOT NULL DEFAULT '[]',
  is_active          BOOLEAN NOT NULL DEFAULT true
);

-- Skills
CREATE TABLE skills (
  skill_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harness_id        UUID NOT NULL REFERENCES harnesses(harness_id),
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  applicable_phases TEXT[] NOT NULL,
  content           TEXT NOT NULL,
  version           INT NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rules
-- applicable_phases determines which phases the rule is checked in.
-- pattern_type determines evaluation strategy: 'path', 'regex', or 'semantic'.
-- enforcement: 'hard' fires a gate on violation; 'soft' logs rule_deviation.
CREATE TABLE rules (
  rule_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harness_id         UUID NOT NULL REFERENCES harnesses(harness_id),
  name               TEXT NOT NULL,
  applicable_phases  TEXT[] NOT NULL,
  constraint_text    TEXT NOT NULL,
  enforcement        TEXT NOT NULL CHECK (enforcement IN ('hard', 'soft')),
  pattern_type       TEXT NOT NULL CHECK (pattern_type IN ('path', 'regex', 'semantic')),
  patterns           TEXT[] NOT NULL DEFAULT '{}',
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memory Records
CREATE TYPE memory_type AS ENUM (
  'TaskPattern', 'FileConvention', 'TeamConvention',
  'GatePattern', 'RiskSignal', 'RepoMap'
);

CREATE TABLE memory_records (
  memory_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harness_id      UUID NOT NULL REFERENCES harnesses(harness_id),
  type            memory_type NOT NULL,
  content         TEXT NOT NULL,
  embedding       VECTOR(1536) NOT NULL,
  source_run_id   UUID,
  relevance_tags  TEXT[] NOT NULL DEFAULT '{}',
  content_hash    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (harness_id, content_hash)
);

-- HNSW index for fast cosine similarity search
CREATE INDEX memory_embedding_hnsw
  ON memory_records USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Memory Staging (per-run, merged into memory_records at Ship by orchestration layer)
CREATE TABLE memory_staging (
  staging_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES runs(run_id),
  harness_id      UUID NOT NULL REFERENCES harnesses(harness_id),
  type            memory_type NOT NULL,
  content         TEXT NOT NULL,
  embedding       VECTOR(1536) NOT NULL,
  relevance_tags  TEXT[] NOT NULL DEFAULT '{}',
  content_hash    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX memory_staging_run ON memory_staging(run_id);
```

### 15.2 Required Audit Event Types Enforcement

A `REQUIRED_AUDIT_EVENT_TYPES` constant is defined in `AuditModule` and a Vitest test asserts that at least one emit site exists in the codebase for each type. This prevents future omissions.

```typescript
// audit/audit-event-types.ts

export const REQUIRED_AUDIT_EVENT_TYPES = [
  // Phase lifecycle
  'run_created', 'phase_started', 'phase_completed',
  // Agent lifecycle
  'agent_invoked', 'agent_completed', 'agent_skipped_on_resume',
  // Artifact flow
  'artifact_handoff',
  // Gate lifecycle
  'gate_fired', 'gate_question_sent', 'gate_answer_received',
  'gate_resumed', 'gate_stalled', 'gate_traversal_backward',
  // Connector and tool calls
  'connector_queried', 'tool_call', 'llm_call',
  // Memory
  'memory_read', 'memory_staged', 'memory_merged',
  // Verification
  'verification_run', 'verification_result',
  // Ship
  'ship_completed', 'ship_failed',
  // Run completion
  'run_completed', 'run_failed', 'run_stopped',
  // Rules and skills
  'rule_deviation', 'skill_applied',
] as const;

export type AuditEventType = typeof REQUIRED_AUDIT_EVENT_TYPES[number];
```

---

## 16. API Design

### 16.1 Route Structure

All routes require JWT authentication via `HarnessAuthGuard`. All responses follow a consistent envelope: `{ data, meta?, error? }`.

```
POST   /api/auth/login
POST   /api/auth/refresh

GET    /api/harnesses
POST   /api/harnesses
GET    /api/harnesses/:harnessId

GET    /api/runs?harnessId=&status=&limit=&cursor=
GET    /api/runs/:runId
POST   /api/runs/:runId/stop
GET    /api/runs/:runId/artifacts/:phase
GET    /api/runs/:runId/audit?limit=&cursor=&eventType=

POST   /api/gate/:gateId/respond

GET    /api/memory?harnessId=&q=&type=&limit=&cursor=
POST   /api/memory
PATCH  /api/memory/:memoryId
DELETE /api/memory/:memoryId

GET    /api/connectors/:harnessId
POST   /api/connectors/:harnessId
PATCH  /api/connectors/:connectorId
DELETE /api/connectors/:connectorId
POST   /api/connectors/:connectorId/test

GET    /api/agents/:harnessId
PATCH  /api/agents/:harnessId/:phase
POST   /api/agents/:harnessId/:phase/pipeline
DELETE /api/agents/:harnessId/:phase/pipeline/:position

GET    /api/skills/:harnessId
POST   /api/skills/:harnessId
PATCH  /api/skills/:skillId
DELETE /api/skills/:skillId

GET    /api/rules/:harnessId
POST   /api/rules/:harnessId
PATCH  /api/rules/:ruleId
DELETE /api/rules/:ruleId

GET    /api/analytics/:harnessId

POST   /api/trigger/:harnessId     (webhook trigger, HMAC auth)
```

### 16.2 Gate Response Endpoint

```typescript
@Controller('gate')
export class GatesController {
  constructor(private readonly gateController: GateControllerService) {}

  @Post(':gateId/respond')
  @UseGuards(HarnessAuthGuard)
  async respond(
    @Param('gateId') gateId: string,
    @Body() dto: RespondToGateDto,
  ) {
    await this.gateController.resolve(gateId, dto.answer);
    return { data: { resolved: true } };
  }
}

class RespondToGateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  answer: string;
}
```

### 16.3 Stop Run Endpoint

```typescript
@Post(':runId/stop')
@UseGuards(HarnessAuthGuard)
async stopRun(
  @Param('runId') runId: string,
  @Body() dto: StopRunDto,
) {
  await this.runManagerService.stopRun(runId, dto.reason ?? 'human_stopped');
  return { data: { stopped: true } };
}
```

### 16.4 Agent Configuration with Locked Preamble Guard

```typescript
@Patch(':harnessId/:phase')
@UseGuards(HarnessAuthGuard, LockedPreambleGuard)
async updateAgentConfig(
  @Param('harnessId') harnessId: string,
  @Param('phase') phase: Phase,
  @Body() dto: UpdateAgentConfigDto,
) {
  await this.agentConfigService.update(harnessId, phase, dto);
  return { data: { updated: true } };
}
```

---

## 17. Real-time Layer

### 17.1 Event Flow

```
AuditLoggerService.log()
  → synchronous write to PostgreSQL for CRITICAL_EVENT_TYPES
  → async BullMQ enqueue for everything else
  → always: publish to Redis channel 'audit-events:{harnessId}'

RunGateway (Socket.io)
  → subscribes to Redis channel via Socket.io Redis adapter
  → emits to room 'harness:{harnessId}'
  → all connected browser clients receive the event immediately
```

Critical event types that require synchronous PostgreSQL writes before any downstream action: `gate_fired`, `gate_question_sent`, `phase_started`, `phase_completed`, `run_completed`, `run_failed`, `gate_traversal_backward`.

### 17.2 RunGateway

```typescript
@WebSocketGateway({ namespace: '/runs', cors: { origin: process.env.FRONTEND_URL } })
export class RunGateway implements OnModuleInit {
  @WebSocketServer() server: Server;

  onModuleInit() {
    this.server.adapter(createAdapter(redisPublisher, redisSubscriber));
  }

  async handleConnection(client: Socket) {
    try {
      const user = await this.authService.verifyToken(client.handshake.auth.token);
      client.data.userId = user.userId;
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('join_harness')
  async handleJoin(client: Socket, harnessId: string) {
    const authorized = await this.harnessAuthService.canAccess(
      client.data.userId,
      harnessId,
    );
    if (!authorized) return { error: 'Unauthorized' };
    client.join(`harness:${harnessId}`);
    return { joined: true };
  }
}
```

### 17.3 AuditLogger Publishing

```typescript
@Injectable()
export class AuditLoggerService {
  private readonly CRITICAL_EVENT_TYPES = new Set([
    'gate_fired', 'gate_question_sent', 'phase_started', 'phase_completed',
    'run_completed', 'run_failed', 'gate_traversal_backward',
  ]);

  async log(event: AuditEventInput): Promise<void> {
    const fullEvent = { eventId: uuidv4(), ...event, createdAt: new Date() };

    if (this.CRITICAL_EVENT_TYPES.has(event.eventType)) {
      await this.prisma.auditEvent.create({ data: fullEvent });
    } else {
      await this.auditWriteQueue.add('write', fullEvent);
    }

    await this.redis.publish(
      `audit-events:${event.harnessId}`,
      JSON.stringify(fullEvent),
    );
  }
}
```

---

## 18. Frontend Architecture

### 18.1 Application Structure

```
src/
├── routes/
│   ├── index.tsx                  (Dashboard)
│   ├── runs/
│   │   ├── index.tsx              (Runs list)
│   │   └── $runId/
│   │       ├── index.tsx          (Run detail — all five phases in timeline)
│   │       ├── artifacts.tsx      (Artifact viewer)
│   │       └── audit.tsx          (Audit timeline)
│   ├── memory/
│   │   └── index.tsx
│   ├── agents/
│   │   └── $harnessId.tsx
│   ├── connectors/
│   │   └── $harnessId.tsx
│   ├── rules/
│   │   └── $harnessId.tsx         (Hard and soft rule management)
│   └── analytics/
│       └── $harnessId.tsx
├── components/
│   ├── RunStatusBadge/
│   ├── PhaseBadge/                (Shows all five phases including TRIGGER)
│   ├── GateResponsePanel/
│   ├── AuditTimeline/
│   ├── ArtifactViewer/
│   ├── AgentPipelineEditor/       (Shows locked preamble as read-only)
│   ├── MemoryRecordTable/
│   ├── ConnectorHealthBadge/
│   ├── RuleEditor/
│   └── GateFrequencyChart/
├── hooks/
│   ├── useRunStream.ts
│   ├── useGateResponse.ts
│   └── useRunAudit.ts
├── api/
│   └── client.ts
└── lib/
    └── socket.ts
```

### 18.2 Run Timeline

The run timeline shows all five phases. The TRIGGER phase is visible as the first entry with its `phase_started` and `phase_completed` audit events. The timeline renders in real time via WebSocket.

### 18.3 Agent Pipeline Editor

The locked preamble is shown as a read-only block with a clear label. The `logTraversalEvent` idempotency mechanism is transparent to users — they see the traversal in the audit timeline without duplicate entries.

```typescript
export function AgentPipelineEditor({ harnessId, phase }) {
  return (
    <div className={styles.editor}>
      {pipeline?.agents.map(agent => (
        <div key={agent.agentId} className={styles.agentCard}>
          <div className={styles.lockedPreamble}>
            <div className={styles.lockedLabel}>
              Framework-owned (read-only)
              <Tooltip content="Gate condition, output contract, and scope constraints. Injected by the system. Cannot be modified." />
            </div>
            <pre className={styles.preambleCode}>{agent.lockedPreamblePreview}</pre>
          </div>
          <div className={styles.editablePrompt}>
            <div className={styles.editableLabel}>Your instructions</div>
            <MonacoEditor
              value={agent.systemPromptBody}
              onChange={value => updateAgentConfig(agent.agentId, { systemPromptBody: value })}
              language="markdown"
              options={{ minimap: { enabled: false }, wordWrap: 'on' }}
            />
          </div>
          <div className={styles.modelSelector}>
            <select value={agent.model} onChange={e => updateAgentConfig(agent.agentId, { model: e.target.value })}>
              <option value="claude-opus-4-5">claude-opus-4-5</option>
              <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
              <option value="gpt-4o">gpt-4o</option>
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### 18.4 Real-time Hook

```typescript
export function useRunStream(runId: string, harnessId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    socket.emit('join_harness', harnessId);

    socket.on('run.event', (event: AuditEvent) => {
      if (event.runId !== runId) return;

      if (['phase_started', 'phase_completed'].includes(event.eventType)) {
        queryClient.invalidateQueries({ queryKey: ['run', runId] });
      }
      if (event.eventType === 'gate_fired') {
        queryClient.invalidateQueries({ queryKey: ['run', runId] });
        queryClient.invalidateQueries({ queryKey: ['run', runId, 'gate'] });
      }
      if (['run_completed', 'run_failed', 'run_stopped'].includes(event.eventType)) {
        queryClient.invalidateQueries({ queryKey: ['runs', harnessId] });
        queryClient.invalidateQueries({ queryKey: ['run', runId] });
      }

      queryClient.setQueryData(
        ['run', runId, 'audit'],
        (old: AuditEvent[] | undefined) => [...(old ?? []), event],
      );
    });

    return () => { socket.off('run.event'); };
  }, [runId, harnessId, queryClient]);
}
```

---

## 19. Security Design

### 19.1 Authentication

JWT tokens in `httpOnly` cookies. Access tokens expire after 15 minutes. Refresh tokens expire after 7 days with rotation on every use.

### 19.2 Harness Authorization Guard

Every route accessing harness-scoped data is protected:

```typescript
@Injectable()
export class HarnessAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const harnessId = request.params.harnessId
      ?? request.body.harnessId
      ?? request.query.harnessId;

    if (!harnessId) throw new BadRequestException('harnessId required');
    if (!user.harnessAccess.includes(harnessId)) throw new ForbiddenException();
    return true;
  }
}
```

### 19.3 Locked Preamble Guard

Applied to all agent configuration update routes. Prevents users from embedding gate condition instructions in the user-editable system prompt body. This is not the primary enforcement mechanism — server-side preamble prepending is. The guard makes the constraint visible at the API surface.

```typescript
@Injectable()
export class LockedPreambleGuard implements CanActivate {
  private readonly forbidden = [
    /fire.{0,20}gate/i,
    /clarification.{0,20}gate/i,
    /context.{0,20}gap/i,
    /gate.{0,20}condition/i,
    /you must.{0,30}fire/i,
  ];

  canActivate(context: ExecutionContext): boolean {
    const body = context.switchToHttp().getRequest().body?.systemPromptBody ?? '';
    for (const pattern of this.forbidden) {
      if (pattern.test(body)) {
        throw new ForbiddenException(
          'System prompt body cannot contain gate condition instructions. These are framework-owned.',
        );
      }
    }
    return true;
  }
}
```

### 19.4 Credential Encryption

```typescript
@Injectable()
export class CredentialEncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyBuffer: Buffer;

  constructor(config: ConfigService) {
    this.keyBuffer = Buffer.from(config.get<string>('ENCRYPTION_KEY'), 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return JSON.stringify({
      iv: iv.toString('hex'),
      data: encrypted.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
    });
  }

  decrypt(ciphertext: string): string {
    const { iv, data, authTag } = JSON.parse(ciphertext);
    const decipher = createDecipheriv(this.algorithm, this.keyBuffer, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
}
```

### 19.5 Audit Log Immutability

Enforced at the PostgreSQL layer via `CREATE RULE` (shown in section 15.1). The `AuditLoggerService` interface exposes no `update` or `delete` methods — mutation is impossible from application code.

### 19.6 Ephemeral Workspace Cleanup

Execute phase workspaces are created via the `tmp` package and cleaned up in a `finally` block regardless of success or failure:

```typescript
const workspace = await this.executeConnector.cloneRepo({ repoId, branch });
try {
  // ... execution work ...
} finally {
  await this.executeConnector.cleanup(workspace);
}
```

---

## 20. Infrastructure and Deployment

### 20.1 Local Development — Docker Compose

```yaml
version: '3.9'
services:
  finch-api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    environment:
      DATABASE_URL: postgresql://finch:finch@finch-postgres:5432/finch
      REDIS_URL: redis://finch-redis:6379
      TEMPORAL_ADDRESS: finch-temporal:7233
    depends_on: [finch-postgres, finch-redis, finch-temporal]
    ports: ['3001:3001']

  finch-worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    environment:
      DATABASE_URL: postgresql://finch:finch@finch-postgres:5432/finch
      REDIS_URL: redis://finch-redis:6379
      TEMPORAL_ADDRESS: finch-temporal:7233
    depends_on: [finch-postgres, finch-redis, finch-temporal]

  finch-web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    ports: ['3000:3000']

  finch-postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: finch
      POSTGRES_PASSWORD: finch
      POSTGRES_DB: finch
    volumes: ['finch_postgres_data:/var/lib/postgresql/data']
    ports: ['5432:5432']

  finch-redis:
    image: redis:7-alpine
    ports: ['6379:6379']

  finch-temporal:
    image: temporalio/auto-setup:1.24
    environment:
      DB: postgresql
      DB_PORT: 5432
      POSTGRES_USER: finch
      POSTGRES_PWD: finch
      POSTGRES_SEEDS: finch-postgres
    depends_on: [finch-postgres]
    ports: ['7233:7233']

  finch-temporal-ui:
    image: temporalio/ui:2.26
    environment:
      TEMPORAL_ADDRESS: finch-temporal:7233
    ports: ['8080:8080']

volumes:
  finch_postgres_data:
```

### 20.2 Kubernetes Production

```
Namespace: finch

Deployments:
  finch-api       2+ replicas, HPA min 2 max 10
  finch-worker    2+ replicas, HPA min 2 max 20
  finch-web       2+ replicas, nginx static file serving

StatefulSets:
  finch-postgres  1 primary + 1 replica, 100Gi PVC

External managed services (recommended for production):
  Temporal Cloud  eliminates self-hosting Temporal
  Redis           Upstash or ElastiCache

Ingress:
  nginx ingress controller
  TLS via cert-manager
  /api/*  → finch-api
  /ws/*   → finch-api (WebSocket upgrade)
  /*      → finch-web
```

### 20.3 GitHub Actions CI/CD

```yaml
jobs:
  lint-and-typecheck:
    steps:
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  unit-tests:
    steps:
      - run: npm run test:unit
        # Includes the REQUIRED_AUDIT_EVENT_TYPES coverage test

  integration-tests:
    services:
      postgres: { image: pgvector/pgvector:pg16 }
      redis:    { image: redis:7-alpine }
    steps:
      - run: npm run db:migrate
      - run: npm run test:integration

  build-and-push:
    if: github.ref == 'refs/heads/main'
    needs: [lint-and-typecheck, unit-tests, integration-tests]
    steps:
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/org/finch-api:${{ github.sha }}

  deploy-staging:
    needs: build-and-push
    steps:
      - run: helm upgrade --install finch ./helm/finch --namespace finch-staging
            --set image.tag=${{ github.sha }}

  deploy-production:
    needs: deploy-staging
    environment: production   # manual approval gate
    steps:
      - run: helm upgrade --install finch ./helm/finch --namespace finch-production
            --set image.tag=${{ github.sha }}
```

---

## 21. Testing Strategy

### 21.1 Unit Tests — Vitest

```typescript
// tests/unit/agent-dispatcher.test.ts

describe('AgentDispatcherService', () => {
  describe('point-of-suspension resume', () => {
    it('skips agents before gate position and resumes from firing agent', async () => {
      const pipeline = [agentA, agentB, agentC]; // positions 0, 1, 2
      const snapshot: GateASnapshot = {
        pipelinePosition: 1, // AgentB fired
        artifactAtSuspension: partialContextObject,
        agentOutputsBeforeGate: [{ position: 0, artifact: agentAOutput }],
      };

      const invocations: string[] = [];
      mockAgentA.run.mockImplementation(() => { invocations.push('A'); return agentAOutput; });
      mockAgentB.run.mockImplementation(() => { invocations.push('B'); return finalContextObject; });
      mockAgentC.run.mockImplementation(() => { invocations.push('C'); return finalContextObject; });

      await dispatcher.runPhase({
        phase: 'ACQUIRE',
        inputArtifact: seedArtifact,
        runId: 'test-run',
        harnessId: 'test-harness',
        resumeFromSnapshot: snapshot,
        source: mockSource,
      });

      // AgentA must NOT be re-run — its work is preserved in the snapshot
      expect(invocations).toEqual(['B', 'C']);
      expect(invocations).not.toContain('A');
    });

    it('persists pipeline position before each agent invocation', async () => {
      await dispatcher.runPhase({ phase: 'ACQUIRE', ...params });
      expect(runRepository.updatePipelinePosition).toHaveBeenCalledWith('test-run', 'ACQUIRE', 0, expect.any(Object));
      expect(runRepository.updatePipelinePosition).toHaveBeenCalledWith('test-run', 'ACQUIRE', 1, expect.any(Object));
    });
  });

  describe('crash recovery', () => {
    it('reads persisted position on entry and fast-forwards past completed steps', async () => {
      runRepository.getPipelineState.mockResolvedValue({
        pipelinePosition: 1,
        pipelineArtifact: agentAOutput,
      });

      const invocations: string[] = [];
      mockAgentB.run.mockImplementation(() => { invocations.push('B'); return output; });

      await dispatcher.runPhase({ phase: 'ACQUIRE', ...params });

      expect(invocations).toEqual(['B']);
    });
  });

  describe('soft rule detection', () => {
    it('emits rule_deviation after agent completes with soft rule violation', async () => {
      ruleEnforcementService.checkSoftRules.mockResolvedValue([
        { rule: softRule, deviation: 'PR exceeds 400 lines' },
      ]);

      await dispatcher.runPhase({ phase: 'PLAN', ...params });

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'rule_deviation' }),
      );
    });
  });

  describe('hard rule gate firing', () => {
    it('fires a gate with rule constraint when hard rule is violated at phase boundary', async () => {
      ruleEnforcementService.checkHardRules.mockResolvedValue({
        violated: true,
        rule: hardRule,
        gateQuestion: 'A hard rule was violated...',
      });

      const result = await dispatcher.runPhase({ phase: 'EXECUTE', ...params });

      expect(result).toBeInstanceOf(GateEvent);
      expect((result as GateEvent).question).toContain(hardRule.name);
    });
  });
});

// tests/unit/gate-controller.test.ts

describe('GateControllerService', () => {
  describe('evaluateTraversal', () => {
    it('always returns ACQUIRE for Gate A without LLM call', async () => {
      const result = await gateController.evaluateTraversal(
        { phase: 'ACQUIRE', ...gateEvent },
        'answer',
      );
      expect(result.targetPhase).toBe('ACQUIRE');
      expect(mockLLM.complete).not.toHaveBeenCalled();
    });

    it('returns PLAN for Gate E when answer changes approach', async () => {
      mockLLM.complete.mockResolvedValue({ text: 'PLAN' });
      const result = await gateController.evaluateTraversal(
        { phase: 'EXECUTE', ...gateEvent },
        'answer that changes approach',
      );
      expect(result.targetPhase).toBe('PLAN');
    });
  });
});

// tests/unit/audit-coverage.test.ts

describe('Required audit event types', () => {
  it('every required audit event type has at least one emit site in the codebase', () => {
    const sourceFiles = glob.sync('src/**/*.ts');
    const source = sourceFiles.map(f => readFileSync(f, 'utf-8')).join('\n');

    for (const eventType of REQUIRED_AUDIT_EVENT_TYPES) {
      const hasEmitSite = source.includes(`eventType: '${eventType}'`);
      expect(hasEmitSite, `Missing emit site for audit event type: ${eventType}`).toBe(true);
    }
  });
});

// tests/unit/execute-agent.test.ts

describe('ExecuteAgentService', () => {
  it('throws ScopeViolationError when writing to excluded path', async () => {
    const context = buildContext({
      planArtifact: buildPlan({
        scopeBoundaries: { excludedPaths: ['/src/auth'], excludedBehaviors: [] },
      }),
    });
    await expect(
      executeAgent.executeToolCall('github_write_file', { path: '/src/auth/jwt.ts' }, context),
    ).rejects.toThrow(ScopeViolationError);
  });
});
```

### 21.2 Integration Tests — Vitest + Supertest

```typescript
// tests/integration/gate-lifecycle.test.ts

describe('Gate lifecycle', () => {
  it('fires gate with typed snapshot, persists state, resumes at correct position', async () => {
    const { runId } = await createTestRun(harnessId);

    const gateEvent = buildGateEvent({
      runId,
      phase: 'ACQUIRE',
      pipelinePosition: 1,
      snapshot: {
        pipelinePosition: 1,
        artifactAtSuspension: partialContextObject,
        agentOutputsBeforeGate: [{ position: 0, artifact: agentAOutput }],
      },
    });

    await gateController.dispatch(gateEvent);

    const run = await runRepository.findById(runId);
    expect(run.status).toBe('WAITING_FOR_HUMAN');

    const saved = await gateRepository.findById(gateEvent.gateId);
    expect(saved.snapshot.pipelinePosition).toBe(1);
    expect(saved.snapshot.agentOutputsBeforeGate).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/api/gate/${gateEvent.gateId}/respond`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ answer: 'The missing information is X' })
      .expect(200);

    const resolved = await gateRepository.findById(gateEvent.gateId);
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolution.snapshot.pipelinePosition).toBe(1);
  });
});

// tests/integration/trigger-phase.test.ts

describe('Trigger phase', () => {
  it('emits phase_started and phase_completed audit events for TRIGGER', async () => {
    const runId = uuidv4();
    await triggerAgent.runPhase(buildRawInput({ runId }));

    const events = await auditRepository.findByRunAndPhase(runId, 'TRIGGER');
    expect(events.map(e => e.eventType)).toContain('phase_started');
    expect(events.map(e => e.eventType)).toContain('phase_completed');
  });

  it('does not write to memory staging during Trigger phase', async () => {
    const runId = uuidv4();
    await triggerAgent.runPhase(buildRawInput({ runId }));

    const staging = await prisma.memoryStaging.findMany({ where: { runId } });
    expect(staging).toHaveLength(0);
  });
});

// tests/integration/memory-merge.test.ts

describe('Memory merge ownership', () => {
  it('merge is called by orchestration layer, not by ShipAgent', async () => {
    // ShipAgent should NOT call mergeRunMemory
    const shipSpy = jest.spyOn(memoryConnector, 'mergeRecord');
    await shipAgent.runPhase(planArtifact, verificationReport, contextObject, repoId);
    expect(shipSpy).not.toHaveBeenCalled();

    // mergeRunMemory activity should call it
    await memoryActivities.mergeRunMemory(planArtifact.runId);
    expect(shipSpy).toHaveBeenCalled();
  });
});
```

### 21.3 End-to-End Tests — Playwright

```typescript
// tests/e2e/run-detail.spec.ts

test('trigger phase appears in run timeline', async ({ page }) => {
  await page.goto(`/runs/${testRunId}`);
  const timeline = page.getByTestId('audit-timeline');
  await expect(timeline.getByText('TRIGGER')).toBeVisible();
  await expect(timeline.getByText('phase_started')).toBeVisible();
});

test('gate response resumes from correct pipeline position', async ({ page }) => {
  await page.goto(`/runs/${testRunId}`);
  const panel = page.getByTestId('gate-response-panel');
  await panel.getByTestId('gate-answer').fill('The answer is Y');
  await panel.getByTestId('gate-submit').click();

  await expect(page.getByTestId('run-status')).toContainText('Running', { timeout: 10000 });

  // Verify in audit timeline that AgentA was skipped on resume
  const timeline = page.getByTestId('audit-timeline');
  await expect(timeline.getByText('agent_skipped_on_resume')).toBeVisible();
});

test('rule deviation appears in audit timeline', async ({ page }) => {
  await page.goto(`/runs/${testRunId}`);
  const timeline = page.getByTestId('audit-timeline');
  await expect(timeline.getByText('rule_deviation')).toBeVisible();
});
```

### 21.4 Agent Quality Evals

Run manually or on a schedule. Use live LLM API calls against known task scenarios.

```typescript
const scenarios = [
  {
    name: 'clear task — no gate expected — Trigger phase produces valid TaskDescriptor',
    rawInput: buildRawInput({ rawText: '@finch implement PROJ-123 as specified' }),
    expectTriggerPhaseAudit: true,
    expectNormalizedIntent: 'implement PROJ-123 as specified',
  },
  {
    name: 'vague task — Gate A expected on requirementsClarity',
    rawInput: buildRawInput({ rawText: '@finch fix the payments thing' }),
    expectGate: true,
    expectedGapDimension: 'requirementsClarity',
  },
  {
    name: 'hard rule violation — gate fires with rule constraint in question',
    rawInput: buildRawInput({ rawText: '@finch update auth module' }),
    activeHardRule: { name: 'Security review required for /src/auth', patternType: 'path', patterns: ['/src/auth'] },
    expectGate: true,
    expectedGateQuestionContains: 'Security review required',
  },
];
```

---

## 22. Observability

### 22.1 Structured Logging — Pino

Every log line includes `run_id`, `harness_id`, `phase`, `agent_id`, and `pipeline_position` where applicable.

```typescript
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

this.logger.info({
  runId: context.runId,
  harnessId: context.harnessId,
  phase: context.phase,
  agentId: context.agentConfig.agentId,
  pipelinePosition: context.pipelinePosition,
  msg: 'Agent loop completed',
  inputTokens: response.usage.inputTokens,
  outputTokens: response.usage.outputTokens,
});
```

### 22.2 OpenTelemetry Instrumentation

```typescript
const sdk = new NodeSDK({
  metricReader: new PrometheusExporter({ port: 9464 }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

Custom Finch metrics:

```typescript
export const gateFireCounter = meter.createCounter('finch_gate_fires_total', {
  description: 'Gate firings by phase and trigger type (agent vs rule enforcement)',
});

export const llmTokensCounter = meter.createCounter('finch_llm_tokens_total', {
  description: 'LLM tokens consumed by agent and model',
});

export const phaseLatencyHistogram = meter.createHistogram('finch_phase_duration_seconds', {
  description: 'Phase execution duration excluding LLM inference',
  boundaries: [0.5, 1, 2, 5, 10, 30],
});

export const pipelinePositionGauge = meter.createObservableGauge('finch_pipeline_position', {
  description: 'Current pipeline position per active run',
});

export const ruleViolationCounter = meter.createCounter('finch_rule_violations_total', {
  description: 'Rule violations by rule type and enforcement (hard vs soft)',
});

export const memoryQueryLatency = meter.createHistogram('finch_memory_query_ms', {
  description: 'Memory semantic query latency',
  boundaries: [50, 100, 200, 500, 1000],
});
```

### 22.3 Key Grafana Dashboards

**Finch Operations:**
- Active runs by status (RUNNING, WAITING_FOR_HUMAN, STALLED)
- Gate fire rate by phase — primary incremental trust signal
- Gate fires by trigger type (agent-identified gap vs rule enforcement)
- Average time to gate resolution
- Phase transition latency (p50, p95, p99)
- Pipeline position distribution across active runs
- Run completion rate
- Rule violation rate by rule type and enforcement

**Finch Cost:**
- LLM token consumption by agent and model
- Cost per run over time
- Cost breakdown: phase agents vs rule evaluation (Haiku calls) vs traversal evaluation
- Most expensive harnesses

**Finch Trust:**
- Gate frequency trend over time per harness — decreasing trend indicates memory accumulation working
- Memory record count growth over time
- Most frequently triggered GatePattern memory types
- Average gate resolution time trend

---

*End of Document*