# Gate Lifecycle & Agent Orchestration Testing

## What This Skill Covers

Testing the TAPES pipeline orchestration: gate firing, traversal classification, agent dispatch, rule enforcement, audit event ordering, and memory staging. Covers both unit tests (303 tests, 100% coverage) and e2e integration tests (35 scenarios against live PostgreSQL).

## Prerequisites

- Docker Compose infra must be running (PostgreSQL, Redis, Temporal)
- Prisma migrations must be applied and seed data loaded
- `ANTHROPIC_API_KEY` env var set (for real LLM calls; e2e tests use MockLLMConnector)

## Infrastructure Setup

```bash
docker compose -f infra/docker-compose.yml up -d
bash infra/healthcheck.sh

export DATABASE_URL=postgresql://finch:finch@localhost:5432/finch
pnpm --filter api prisma generate
pnpm --filter api prisma migrate deploy
pnpm --filter api prisma db seed
```

## Running Tests

### Backend Unit Tests (api)
```bash
pnpm --filter api test run          # Run all unit tests
npx vitest run --coverage            # Run with coverage (from apps/api/)
```
- 303 tests across 39 files
- Coverage: 100% (734/734 stmts, 257/257 branches, 193/193 funcs, 713/713 lines)
- Covers: agents (trigger, acquire, plan, execute, ship), base-agent loop, gate controller, agent dispatcher, rule enforcement, LLM connectors (anthropic, openai), connector registry, memory connector, audit logger, repositories, health controller, app module, main bootstrap

### Frontend Unit Tests (web)
```bash
pnpm --filter web test run
npx vitest run --coverage            # from apps/web/
```
- 6 tests across 2 files
- Coverage: 100% (8/8 stmts, 0/0 branches, 2/2 funcs, 8/8 lines)

### Integration Tests (api, requires live PostgreSQL)
```bash
pnpm --filter api test:integration
```
- 117 tests across 4 files
- Includes 35 e2e gate lifecycle scenarios + schema/seed/repository tests

## E2E Gate Lifecycle Scenarios (35 total)

### Core Workflow (Scenarios 1-17)
1. Happy path — all 5 TAPES phases complete, no gates
2. Gate A fires in ACQUIRE — dispatch, WAITING_FOR_HUMAN, timeout scheduling
3. Gate P fires in PLAN — backward traversal to ACQUIRE
4. Gate E fires in EXECUTE — forward/backward classification
5. Resume activities — gate answers incorporated into artifacts
6. Pipeline position tracking (FF-09)
7. Agent dispatcher pipeline — registerPhaseRunner, no-agents fallback
8. Multi-gate sequence — ACQUIRE then PLAN then EXECUTE gates
9. Error handling — agent throws, gate/run cleanup
10. Memory connector query — memory_read audit event
11. Gate snapshot pipeline position — FF-09 compliance
12. Gate timeout cancellation — BullMQ job removal on resolve
13. Traversal classification error fallback — LLM error, stays in current phase
14. Traversal classification invalid response — non-phase string, stays in current phase
15. Ship agent stage_memory tool — memory_staged audit event
16. Gate dispatch with trigger connector — question forwarded to webhook channel
17. Full pipeline end-to-end — all 5 phases with audit events

### Workflow Coverage Expansion (Scenarios 18-35)
18. Hard rule violation — path pattern fires gate
19. Hard rule violation — regex pattern
20. Hard rule violation — semantic LLM evaluation (YES/NO/error fallback)
21. Soft rule deviation logging — multiple deviations, filtering by enforcement
22. Invalid regex pattern — graceful handling (returns false)
23. Gate P forward — resolves to PLAN (stays in phase, no backward traversal)
24. Gate E backward to ACQUIRE — deepest traversal path
25. Cascading traversal — E to ACQUIRE then PLAN gate fires
26. Double gate in same phase — ACQUIRE fires twice before succeeding
27. stopRunSignal — run status transitions (RUNNING to FAILED, WAITING_FOR_HUMAN to FAILED)
28. Agent loop max iterations (50) — throws error
29. Agent loop with non-fire_gate tool calls — stage_memory, unknown tool error handling
30. Gate snapshot shape — GatePSnapshot includes contextObject
31. Gate snapshot shape — GateESnapshot includes executionProgress, planArtifact
32. Resume from snapshot — agent_skipped_on_resume audit events
33. Memory merge after Ship — stageRecord + mergeRecords flow
34. Gate in TRIGGER/SHIP — GateEvent returned but handled gracefully (architectural gaps)
35. parseOutput fallback — all 5 agents return defaults on invalid JSON

## MockLLMConnector API

The e2e tests use `MockLLMConnector` instead of real LLM calls:
```typescript
mockLLM.enqueue(response)           // Raw LLMResponse
mockLLM.enqueueJson(json)           // JSON wrapped in end_turn response
mockLLM.enqueueGate(gap, question)  // fire_gate tool_use response
mockLLM.enqueueClassification(phase) // Traversal classification (ACQUIRE/PLAN/EXECUTE)
mockLLM.enqueueToolUse(name, input) // Non-fire_gate tool_use response
mockLLM.reset()                     // Clear queue and call log
```

## Coverage Targets

Both api and web target 100% coverage. The `all: true` flag in vitest configs ensures all source files are included.

## CI Workflow

`.github/workflows/ci.yml`:
- `unit-tests` job: runs `pnpm --filter api test run` and `pnpm --filter web test run`
- `integration-tests` job: starts PostgreSQL + Redis, runs prisma generate/migrate/seed, then `pnpm --filter api test:integration`

## Known Gotchas

- **Prisma generate required before tests**: Without `prisma generate`, the `.prisma/client/default` module is missing
- **Seed data required**: `prisma db seed` must run before integration tests
- **Non-deterministic ordering**: Use `orderBy: { agentConfigId: 'asc' }` for agent_configs queries
- **AppModule production test mutates NODE_ENV**: Restored in `afterEach`
- **Default harness UUID**: `00000000-0000-0000-0000-000000000001` — used by all e2e tests
- **MockLLMConnector queue**: Must `reset()` in `beforeEach` — stale responses cause test bleed
- **Gate IDs are UUIDs**: Generated per-gate via `uuidv4()` — never hardcode in assertions
- **supertest needed for customProps coverage**: The pino `customProps` callback is only called during HTTP requests

## Secrets

- `ANTHROPIC_API_KEY` — permanent secret for real LLM calls (not used by e2e tests)
- PostgreSQL: `finch/finch/finch` (local Docker defaults)
