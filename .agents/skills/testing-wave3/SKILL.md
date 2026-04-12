# Testing Wave 3 — Gate Lifecycle & Agent Layer

## Prerequisites
- Docker Compose infra running: `docker compose -f infra/docker-compose.yml up -d`
- PostgreSQL available at `localhost:5432` (finch/finch/finch)
- Prisma migrations applied: `pnpm --filter api prisma migrate deploy`
- Seed data loaded: `pnpm --filter api prisma db seed`

## Running Tests

### Unit tests (303 tests, 39 files)
```bash
pnpm --filter api test
```

### Integration tests (80 tests, 4 files)
```bash
pnpm --filter api test:integration
```

### Coverage (must be 100%)
```bash
cd apps/api && npx vitest run --coverage
```

Expected: 100% statements, branches, functions, lines.

## E2E Gate Lifecycle Tests

File: `apps/api/tests/integration/e2e-gate-lifecycle.spec.ts`

### Architecture
- **MockLLMConnector** — implements `LLMConnector` interface, queues deterministic responses
- **MockQueue** — simulates BullMQ for audit and timeout job tracking
- **Real PostgreSQL** — tests run against live database
- **Real service instances** — not NestJS test module, direct instantiation

### Key Patterns

#### MockLLMConnector usage
```typescript
mockLLM.enqueueJson({ output: 'value' }); // Queue a JSON response
mockLLM.enqueueGate('question text');       // Queue a fire_gate tool call
mockLLM.enqueueClassification('ACQUIRE');   // Queue a traversal classification
mockLLM.complete();                          // Queue a phase completion (no tool call)
```

#### Audit event routing
- **Critical events** (synchronous to DB): `gate_fired`, `gate_question_sent`, `phase_started`, `phase_completed`, `gate_traversal_backward`
- **Non-critical events** (enqueued to BullMQ): `memory_read`, `llm_call`, `gate_resumed`, `memory_staged`, `tool_call`, `agent_invoked`
- Check DB: `auditRepo.findByRunId(runId)`
- Check queue: `mockAuditQueue.jobs.filter(j => j.data.eventType === '...')`

#### Test isolation
- `beforeAll()` — set up services once
- `beforeEach()` — reset only MockLLM (NOT queues — some sequential tests depend on queue state)
- `afterAll()` — cleanup test data from PostgreSQL
- Track created run IDs in `createdRunIds` array for cleanup

### 17 Test Scenarios
1. Happy path (no gates)
2. Gate A fires in ACQUIRE
3. Gate P fires in PLAN (backward traversal)
4. Gate E fires in EXECUTE
5. Resume activities (gate answers in artifacts)
6. Pipeline position tracking (FF-09)
7. Agent dispatcher pipeline
8. Multi-gate sequence
9. Error handling (404, unregistered provider)
10. Memory connector
11. Gate snapshot pipeline position
12. Gate timeout cancellation
13. Traversal classification error fallback
14. Invalid LLM response fallback
15. Ship agent stage_memory
16. Gate dispatch with trigger connector
17. Full pipeline end-to-end

## Manual E2E Testing

### Start the API
```bash
pnpm --filter api dev
```

### Trigger a run
```bash
curl -X POST http://localhost:3001/api/trigger/default \
  -H 'Content-Type: application/json' \
  -d '{"rawText": "fix the payments thing"}'
```

### Check run status
```bash
curl http://localhost:3001/api/runs/<runId>
```

### Resolve a gate (when WAITING_FOR_HUMAN)
```bash
curl -X POST http://localhost:3001/api/gate/<gateId>/respond \
  -H 'Content-Type: application/json' \
  -d '{"answer": "The payments module is in src/payments"}'
```

### Verify completion
- Temporal UI: http://localhost:8080 (check workflow status = COMPLETED)
- PostgreSQL: `SELECT status FROM runs WHERE run_id = '<runId>'`

## Common Issues
- **Gate signal mismatch**: Signal name must be `'gate_resolved'` (not `'gateResolution'`). Mismatch causes workflows to hang silently.
- **Queue reset in beforeEach**: Don't reset queues between related sequential tests — they depend on accumulated state.
- **Pipeline position**: Uses last-write-wins semantics (single field on run record, not per-position history).
- **ANTHROPIC_API_KEY**: Required for manual testing with real LLM. Available as environment secret.
