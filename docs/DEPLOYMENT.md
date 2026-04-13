# Finch — Production Deployment Guide

This guide covers deploying Finch using Docker Compose on a single VM (e.g., AWS EC2, DigitalOcean Droplet, Hetzner, any Linux server with Docker installed).

## Prerequisites

- Docker Engine 24+ and Docker Compose v2
- A Linux VM with at least **2 vCPU / 4 GB RAM** (recommended: 4 vCPU / 8 GB RAM)
- Ports 3000 (web), 3001 (API), 8080 (Temporal UI), 3030 (Grafana) open in your firewall/security group
- An Anthropic or OpenAI API key for LLM-powered agent execution

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/AOByte/finch.git
cd finch

# 2. Create your .env file from the example
cp .env.example .env

# 3. Generate secure secrets (or set your own)
sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|REDIS_PASSWORD=.*|REDIS_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env

# 4. Set your LLM API keys
#    Edit .env and add your ANTHROPIC_API_KEY and/or OPENAI_API_KEY

# 5. Set the public URLs (replace with your server's IP or domain)
#    Edit .env:
#      FRONTEND_URL=http://YOUR_SERVER_IP:3000
#      VITE_API_URL=http://YOUR_SERVER_IP:3001

# 6. Build and start everything
docker compose -f docker-compose.prod.yml up -d --build

# 7. Verify all services are healthy
docker compose -f docker-compose.prod.yml ps
```

## What Gets Deployed

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| **PostgreSQL** | finch-postgres | 5432 | pgvector-enabled database |
| **Redis** | finch-redis | 6379 | Caching, BullMQ queues, session store |
| **Temporal** | finch-temporal | 7233 | Workflow orchestration engine |
| **Temporal UI** | finch-temporal-ui | 8080 | Temporal web dashboard |
| **API** | finch-api | 3001 | NestJS backend (REST + WebSocket) |
| **Web** | finch-web | 3000 | React frontend (served by nginx) |
| **Prometheus** | finch-prometheus | 9090 | Metrics collection |
| **Grafana** | finch-grafana | 3030 | Dashboards and alerting |

## Environment Variables

See [`.env.example`](../.env.example) for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password |
| `REDIS_PASSWORD` | Yes | Redis password |
| `JWT_SECRET` | Yes | JWT signing key (64-char hex recommended) |
| `ENCRYPTION_KEY` | Yes | Credential encryption key (64-char hex) |
| `ANTHROPIC_API_KEY` | No* | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | No* | OpenAI API key for embeddings + GPT models |
| `FRONTEND_URL` | Yes | Public URL of the web frontend (for CORS) |
| `VITE_API_URL` | Yes | Public URL of the API (baked into frontend at build time) |

*At least one LLM provider key is required for agent execution.

## Using a Custom Domain

If you have a domain (e.g., `finch.example.com`), you can put a reverse proxy (Caddy, nginx, Traefik) in front of the stack:

```
finch.example.com       → finch-web:3000
api.finch.example.com   → finch-api:3001
temporal.finch.example.com → finch-temporal-ui:8080
grafana.finch.example.com  → finch-grafana:3000
```

Example with Caddy (automatic HTTPS):

```Caddyfile
finch.example.com {
    reverse_proxy finch-web:3000
}

api.finch.example.com {
    reverse_proxy finch-api:3001
}
```

When using a reverse proxy, update your `.env`:

```
FRONTEND_URL=https://finch.example.com
VITE_API_URL=https://api.finch.example.com
```

Then rebuild the frontend (the API URL is baked in at build time):

```bash
docker compose -f docker-compose.prod.yml up -d --build finch-web
```

## Operations

### View logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f finch-api
```

### Restart a service

```bash
docker compose -f docker-compose.prod.yml restart finch-api
```

### Update to a new version

```bash
git pull origin master
docker compose -f docker-compose.prod.yml up -d --build
```

### Database backup

```bash
docker exec finch-postgres pg_dump -U finch finch > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Database restore

```bash
cat backup.sql | docker exec -i finch-postgres psql -U finch finch
```

### Run Prisma migrations manually

```bash
docker exec finch-api npx prisma migrate deploy
```

## Troubleshooting

### API fails to start

Check that Postgres and Redis are healthy first:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs finch-api
```

Common issues:
- **Authentication failed against database server**: `POSTGRES_PASSWORD` in `.env` doesn't match the password stored in the Postgres volume. Either fix the password or delete the volume: `docker volume rm finch_postgres_data` and restart.
- **NOAUTH Authentication required**: `REDIS_PASSWORD` not set or BullMQ not receiving the password.

### Frontend shows "Network Error" or CORS errors

- Verify `CORS_ORIGIN` / `FRONTEND_URL` in the API environment matches the exact URL the browser uses (including protocol and port).
- Verify `VITE_API_URL` was set correctly **before** building the frontend. It's baked in at build time — changing `.env` alone won't work. Rebuild: `docker compose -f docker-compose.prod.yml up -d --build finch-web`.

### Temporal workflows not running

```bash
docker compose -f docker-compose.prod.yml logs finch-temporal
```

Temporal needs Postgres to be fully healthy before it can start. If Postgres was slow to initialize, restart Temporal:

```bash
docker compose -f docker-compose.prod.yml restart finch-temporal
```
