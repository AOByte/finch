# Finch API Testing

## Prerequisites

### Docker Infrastructure
All services must be running before testing:
```bash
docker compose -f infra/docker-compose.yml up -d
bash infra/healthcheck.sh
pnpm --filter api prisma migrate deploy
pnpm --filter api prisma db seed
```

Services: `finch-postgres` (5432), `finch-redis` (6379), `finch-temporal` (7233), `finch-temporal-ui` (8080)

### Devin Secrets Needed
- `OPENAI_API_KEY` — Required for EmbeddingService (text-embedding-3-small)
- `ANTHROPIC_API_KEY` — Required for LLM calls (AnthropicConnectorService)
- `ENCRYPTION_KEY` — 64 hex chars (32 bytes). Generate with: `python3 -c "import secrets; print(secrets.token_hex(32))"`

## Running Tests

### Unit Tests
```bash
cd apps/api && npx vitest run --config vitest.config.ts
```
Expected: 600+ tests across 60+ files. Uses mocked dependencies (no Docker needed).

### Integration Tests
```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts
```
Expected: 290+ tests. Requires live Postgres. Some tests skipped unless `RUN_E2E=true`.

### Web Unit Tests
```bash
cd apps/web && npx vitest run
```
Expected: 6 tests.

## Live API Testing

### Starting the Server
```bash
export ENCRYPTION_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
pnpm --filter api dev
```
Server starts on port 3001. Watch for `Nest application successfully started`.

### Key Endpoints
- `GET /api/harnesses` — List all harnesses. Seeded harness: `00000000-0000-0000-0000-000000000001`
- `GET /api/agents?harnessId=<id>` — List agent configs for a harness
- `GET /api/analytics/<harnessId>` — Returns 5 analytics sections (gateFrequencyByPhase, gateFrequencyTrend, avgGateResolutionTime, completionRate, llmCostByAgent)
- `GET /api/memory?harnessId=<id>` — List memory records (paginated)
- `GET /api/memory?harnessId=<id>&q=<query>` — Semantic search via pgvector cosine similarity
- `POST /api/memory` — Stage a memory record (requires valid `runId` from `runs` table due to FK constraint)
- `GET /api/runs?harnessId=<id>` — List runs
- `POST /api/runs/<runId>/stop` — Stop a running workflow

### Memory Endpoint Notes
- `GET /api/memory` without `harnessId` returns 400
- `POST /api/memory` requires a body with `harnessId`, `type`, `content`. Valid `type` values: `TaskPattern`, `FileConvention`, `TeamConvention`, `GatePattern`, `RiskSignal`, `RepoMap`
- The `runId` field defaults to `00000000-0000-0000-0000-000000000000` which may not exist — always pass a valid runId from the `runs` table
- To get a valid runId: query the DB via `node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.run.findFirst().then(r => console.log(r.runId)).finally(() => p.\$disconnect())"`

## Common Issues
- **ENCRYPTION_KEY not set** — Server crashes at startup with `ENCRYPTION_KEY must be exactly 64 hex characters`
- **Redis adapter warning** — `Redis adapter setup failed: server.adapter is not a function` is non-fatal; WebSocket runs without Redis adapter
- **Jira/GitHub/Slack warnings** — Expected when tokens not configured; connectors disabled gracefully
- **`/api/health` returns 404** — Health controller may not be registered in AppModule routing depending on wave
