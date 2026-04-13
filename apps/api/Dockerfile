# ── Stage 1: Install & Build ──────────────────────────────────────────────────
FROM node:20-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy source first, then install so pnpm symlinks are created correctly
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/types ./packages/types
COPY apps/api ./apps/api

# Remove any local node_modules that may contain broken symlinks
RUN rm -rf apps/api/node_modules node_modules

RUN pnpm install --frozen-lockfile --filter api --filter @finch/types

# Generate Prisma client and build
RUN cd apps/api && npx prisma generate
RUN cd apps/api && npx nest build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the full node_modules tree (includes pnpm hoisted deps + Prisma client)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/types ./packages/types
COPY --from=build /app/package.json ./package.json

ENV NODE_ENV=production
EXPOSE 3001

WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/apps/api/src/main.js"]
