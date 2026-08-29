# syntax=docker/dockerfile:1

# One image builds the whole monorepo; the service is chosen at run time.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/ledger/package.json packages/ledger/
COPY packages/reward-engine/package.json packages/reward-engine/
COPY packages/telegram/package.json packages/telegram/
COPY packages/ton/package.json packages/ton/
COPY packages/ai/package.json packages/ai/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
COPY apps/miniapp/package.json apps/miniapp/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @cle/db exec prisma generate
# The Mini App bakes its API URL in at build time.
ARG API_URL=http://localhost:4101
ENV API_URL=$API_URL
RUN pnpm build

FROM build AS runtime
ENV NODE_ENV=production
# The API, worker and bot run from TypeScript sources through tsx; the Mini App
# is a compiled Next.js build. CMD is overridden per service in compose.
CMD ["pnpm", "--filter", "@cle/api", "exec", "tsx", "src/main.ts"]
