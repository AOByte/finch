# ── Stage 1: Install & Build ──────────────────────────────────────────────────
FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy source first, then install so pnpm symlinks are created correctly
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/types ./packages/types
COPY apps/web ./apps/web

# Remove any local node_modules that may contain broken symlinks
RUN rm -rf apps/web/node_modules node_modules

RUN pnpm install --frozen-lockfile --filter web --filter @finch/types

ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=${VITE_API_URL}

RUN cd apps/web && pnpm exec vite build

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
