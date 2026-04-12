# Finch

Finch is a production-grade agentic harness for software development teams. It orchestrates LLM-powered agents through a structured five-phase pipeline (Trigger · Acquire · Plan · Execute · Ship) with durable execution, human-in-the-loop gates, and semantic memory.

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker & Docker Compose

## Quick Start

### 1. Start infrastructure services

```bash
docker compose -f infra/docker-compose.yml up -d
bash infra/healthcheck.sh
```

This starts PostgreSQL (with pgvector), Redis, Temporal, and Temporal UI.

### 2. Run database migrations

```bash
pnpm --filter api prisma migrate deploy
```

### 3. Start the API

```bash
pnpm --filter api dev
```

The API runs on [http://localhost:3001](http://localhost:3001). Health check: `GET /health`.

### 4. Start the frontend

```bash
pnpm --filter web dev
```

The web app runs on [http://localhost:3000](http://localhost:3000).

### 5. Temporal UI

Temporal UI is available at [http://localhost:8080](http://localhost:8080).

## Documentation

- [AGENTS.md](./AGENTS.md) — Agent instructions, architecture, and coding standards
- [System Design Document](./docs/SDD.md) — Detailed system design and schema reference
