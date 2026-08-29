# Architecture

CLE is a TypeScript pnpm monorepo. `apps/api` is the authoritative boundary for authentication, eligibility and money. PostgreSQL stores immutable financial history through `LedgerEntry`; all TON amounts are `bigint` nanotons. Redis/BullMQ runs idempotent workers. The Mini App only renders server-derived values and submits untrusted inputs.

`packages/core` contains deterministic, pure financial algorithms. `packages/db` owns Prisma persistence. Telegram and TON integrations implement provider interfaces, so `APP_MODE=mock` enables complete local flows without secrets. A reward cycle consumes an immutable eligibility snapshot and configuration snapshot; finalized history is never mutated.

