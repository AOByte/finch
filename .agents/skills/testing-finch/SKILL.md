# Testing Finch Wave 1

## Prerequisites

- Docker Compose infra must be running (PostgreSQL, Redis, Temporal)
- Prisma migrations must be applied and seed data loaded

## Infrastructure Setup

```bash
# Start infra services
docker compose -f infra/docker-compose.yml up -d
bash infra/healthcheck.sh

# Apply migrations and seed
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
- 20 tests across 4 files
- Covers: health controller, AppModule (dev + production mode), main.ts bootstrap, 10 module stubs
- Coverage config: `apps/api/vitest.config.ts` with `all: true`

### Frontend Unit Tests (web)
```bash
pnpm --filter web test run           # Run all unit tests
npx vitest run --coverage            # Run with coverage (from apps/web/)
```
- 6 tests across 2 files
- Covers: routes.tsx (routeTree, getParentRoute, Index component), main.tsx (createRoot + render)
- Coverage config: `apps/web/vitest.config.ts` with jsdom environment

### Integration Tests (api, requires live PostgreSQL)
```bash
pnpm --filter api test:integration
```
- 31 tests across 2 files
- Covers: schema validation (extensions, tables, audit rules, CHECK constraints, indexes, enums), seed data verification
- Requires `DATABASE_URL` env var pointing to a running PostgreSQL instance

## Coverage Targets

Both api and web target 100% coverage. The `all: true` flag in vitest configs ensures all source files are included even if not directly imported by tests.

## CI Workflow

The CI runs in `.github/workflows/ci.yml`:
- `unit-tests` job: runs both `pnpm --filter api test run` and `pnpm --filter web test run`
- `integration-tests` job: starts PostgreSQL + Redis services, runs `prisma generate`, `prisma migrate deploy`, `prisma db seed`, then `pnpm --filter api test:integration`

## Known Gotchas

- **Prisma generate required before integration tests**: Without `prisma generate`, the `.prisma/client/default` module isn't built and tests fail with a module-not-found error
- **Seed data required for seed.spec.ts**: The `prisma db seed` step must run before integration tests
- **Non-deterministic ordering**: When querying agent_configs, use `orderBy: { agentConfigId: 'asc' }` instead of `orderBy: { position: 'asc' }` since all configs have `position: 0`
- **AppModule production test mutates NODE_ENV**: Restored in `afterEach`, but be aware if adding tests that depend on NODE_ENV in the same file
- **Frontend 0/0 branches**: Expected — `routes.tsx` and `main.tsx` contain no conditional logic
- **supertest needed for customProps coverage**: The pino `customProps` callback on `app.module.ts` line 29 is only called during HTTP requests, so the test uses supertest to make a real request

## Devin Secrets Needed

None — all tests use local Docker services with default credentials (finch/finch/finch for PostgreSQL).
