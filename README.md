# CLE — Create, Learn & Earn

A multi-tenant Telegram Mini App platform. Any creator connects their channel,
CLE turns each post into an AI quiz, and the channel's revenue is split — CLE
fee first, then the creator's share, then the community — and paid to members in
TON.

```
CHANNEL REVENUE → CLE FEE (10%) → CREATOR SHARE (0–10% of the rest) → COMMUNITY SHARE
                                                                            ↓
                                              GROWTH · LOYALTY · REFERRAL · LEARNING pools
                                                                            ↓
                                                        MEMBER LEDGER → TON PAYOUT
```

The platform is multi-tenant from the first row of the schema: a second creator
can be onboarded without touching the data model or the reward engine.

## Layout

```
apps/
  api/       Fastify modular monolith — the only place money and eligibility are decided
  bot/       Telegram bot: webhook registration and a long-polling bridge for local work
  worker/    Scheduled jobs: quiz generation, membership sync, referral qualification, payouts
  miniapp/   Next.js Mini App — member area, creator dashboard, platform administration
packages/
  core/          Money, revenue split, reward pools, loyalty tiers, quiz scoring (pure)
  ledger/        Double-entry posting rules and balance projection (pure)
  reward-engine/ Cycle → eligibility snapshot → pools → allocations (pure)
  ai/            Provider-neutral AI plus the quiz pipeline and its quality gate
  telegram/      initData verification, Bot API client, membership state machine, deep links
  ton/           Address parsing, ton_proof verification, payout providers
  db/            Prisma schema and client
  config/        Typed, validated environment
e2e/         Playwright browser tests
docs/        Architecture, API, deployment and the manual testing guide
```

## Running it locally

Prerequisites: Node 22+, pnpm 11+, Docker.

```bash
docker compose up -d              # PostgreSQL on 5432, Redis on 6380
cp .env.example .env              # set SESSION_SECRET to 32+ random characters
pnpm install
pnpm db:deploy                    # apply migrations
pnpm seed:demo                    # build a complete demo world (APP_MODE=mock only)

pnpm --filter @cle/api dev        # API on http://localhost:4101
pnpm --filter @cle/miniapp dev    # Mini App on http://localhost:4100
```

`pnpm seed:demo` prints the links to open the Mini App as the creator, as a
learner and as a platform administrator.

### Two modes

`APP_MODE=mock` — no Telegram, TON or AI credentials are required. The Bot API,
the blockchain and the model are simulated, and the Mini App accepts
`?mockUser=<telegram id>` instead of signed `initData`. Everything else, including
the ledger, runs exactly as it does in production.

`APP_MODE=live` — real bot token, real webhook secret, real TON payouts. The
mock sign-in shortcut is unreachable.

## Scripts

| command | what it does |
| --- | --- |
| `pnpm typecheck` | TypeScript across every package |
| `pnpm test` | Unit tests (no infrastructure needed) |
| `pnpm test:integration` | Database-backed tests for the API, worker, bot and schema |
| `pnpm test:e2e` | Playwright browser tests against a freshly seeded world |
| `pnpm build` | Build every package and the Mini App |
| `pnpm seed:demo` | Build the demo world (add `-- --reset` to rebuild from empty) |
| `pnpm demo:join <telegramId>` | Add one more simulated subscriber to the demo community |
| `pnpm worker:once` | Run a single maintenance pass and print the report |
| `pnpm bot:poll` | Long-poll Telegram and feed updates through the webhook handler |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the platform is put together and why
- [docs/API.md](docs/API.md) — the `/api/v1` surface
- [docs/TESTING.md](docs/TESTING.md) — пошаговая ручная проверка на тестовом канале
- [docs/DEPLOY.md](docs/DEPLOY.md) — going live with a real bot, channel and TON
- [PLAN.md](PLAN.md) and [STATUS.md](STATUS.md) — what is built and what is not
