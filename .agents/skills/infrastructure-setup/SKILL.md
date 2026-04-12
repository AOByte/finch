# Finch Infrastructure & Dev Environment Setup

## What This Skill Covers

Setting up and verifying the Finch development infrastructure: Docker Compose services (PostgreSQL with pgvector, Redis, Temporal Server + UI), database migrations, seed data, dev servers, and TypeScript compilation. This is the foundation all other testing depends on.

## Prerequisites

- Docker must be running
- Node 20+ with pnpm (via corepack)

## Starting Infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
bash infra/healthcheck.sh  # must exit 0

export DATABASE_URL=postgresql://finch:finch@localhost:5432/finch
pnpm --filter api prisma generate
pnpm --filter api prisma migrate deploy
pnpm --filter api prisma db seed
```

## Starting Dev Servers

**Important:** Start servers sequentially to avoid port conflicts. If ports 3000/3001 are already in use, Vite will silently pick the next available port.

```bash
# Start API first (port 3001)
pnpm --filter api dev
# Then start web (port 3000)
pnpm --filter web dev
```

To check for port conflicts:
```bash
ss -tlnp | grep -E '300[0-3]'
```

## Verification Endpoints

| Service | URL | Expected |
|---------|-----|----------|
| API Health | http://localhost:3001/health | `{"status":"ok","service":"finch-api","timestamp":"<ISO>"}` |
| Web App | http://localhost:3000 | Page with `<h1>Finch</h1>` |
| Temporal UI | http://localhost:8080 | Workflow list page |

## Database Verification Queries

```bash
# pgvector extension
docker exec finch-postgres psql -U finch -d finch -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
# Expected: 1 row

# Audit rules (immutable audit_events table)
docker exec finch-postgres psql -U finch -d finch -c "SELECT rulename FROM pg_rules WHERE tablename = 'audit_events';"
# Expected: no_audit_update, no_audit_delete

# Seed data
docker exec finch-postgres psql -U finch -d finch -c "SELECT COUNT(*) FROM harnesses WHERE name = 'default';"  # 1
docker exec finch-postgres psql -U finch -d finch -c "SELECT COUNT(*) FROM users WHERE email = 'admin@finch.local';"  # 1
docker exec finch-postgres psql -U finch -d finch -c "SELECT COUNT(*) FROM agent_configs WHERE harness_id = (SELECT harness_id FROM harnesses WHERE name = 'default');"  # 5
```

## TypeScript Verification

```bash
pnpm --filter api exec tsc --noEmit   # must exit 0
pnpm --filter web exec tsc --noEmit   # must exit 0
```

## Docker Services

| Container | Port | Image | Purpose |
|-----------|------|-------|---------|
| finch-postgres | 5432 | pgvector/pgvector:pg16 | Primary database with vector extension |
| finch-redis | 6379 | redis:7-alpine | BullMQ job queue (audit, gate timeout) |
| finch-temporal | 7233 | temporalio/auto-setup:1.24 | Workflow orchestration server |
| finch-temporal-ui | 8080 | temporalio/ui:2.31.2 | Temporal web dashboard |

## Known Gotchas

- **Temporal auto-setup image**: Requires `DB=postgres12` (not `postgresql`) and `DB_PORT=5432` (defaults to MySQL's 3306). Without these, the server loops on "Waiting for PostgreSQL to startup" even though PostgreSQL is healthy.
- **Temporal UI version**: Tag `2.26` doesn't exist on Docker Hub. Use `2.31.2` or latest available.
- **Prisma version**: Using v5 (not v7) for NestJS 10 compatibility. v7 removed `url` from datasource block.
- **Prisma generate required**: Must run `prisma generate` before any test or build step. Without it, the `.prisma/client/default` module is missing.
- **Pino logger**: API logs include `"service": "finch-api"` via `customProps` in `app.module.ts`. Logs may appear as binary when grepping — use `strings` to extract text.
- **Port conflicts**: When restarting dev servers, old Node processes may hold ports. Use `ss -tlnp` to diagnose and `kill -9 <pid>` to clear.
- **Default harness UUID**: `00000000-0000-0000-0000-000000000001` — well-known ID used across all tests and seed data.

## Credentials

- PostgreSQL: `finch`/`finch`/`finch` (user/password/database)
- Seed user: `admin@finch.local` / `finch-dev-password`
- `ANTHROPIC_API_KEY` — permanent Devin secret for real LLM calls

## Secrets

No external secrets required for infrastructure setup — all credentials are local Docker defaults. `ANTHROPIC_API_KEY` is only needed when running the API server with real LLM calls.
