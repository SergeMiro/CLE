# Implementation plan

## Done

- [x] **Foundation** — pnpm/Turborepo workspace, Docker PostgreSQL and Redis, typed
      configuration with start-up validation, Prisma multi-tenant schema (41 tables).
- [x] **Financial core** — `@cle/core`: nanoton arithmetic, platform fee → creator
      share → community share, reward pool split, loyalty tiers, quiz scoring.
- [x] **Ledger** — `@cle/ledger`: double-entry postings, balance projection,
      whole-ledger invariants, negative-custody detection.
- [x] **Reward engine** — `@cle/reward-engine`: eligibility evaluation and
      deterministic allocation across growth, loyalty, referral and learning pools.
- [x] **Telegram** — `@cle/telegram`: initData verification, Bot API client (HTTP,
      mock and shared-file mock), membership state machine, permission inspection,
      deep links.
- [x] **TON** — `@cle/ton`: address parsing and validation, ton_proof verification,
      mock and HTTP payout providers.
- [x] **AI** — `@cle/ai`: provider-neutral abstraction (OpenRouter, Gemini,
      Anthropic, OpenAI-compatible, offline mock), quiz pipeline, schema validation,
      quality gate, usage accounting.
- [x] **API** — Fastify modular monolith: auth and sessions, organizations, channels,
      communities, versioned policies, content, quizzes, revenue, reward cycles,
      referrals, wallets, withdrawals, analytics, platform administration, Telegram
      webhook. RBAC and tenant isolation on every route.
- [x] **Bot** — webhook registration plus a long-polling bridge that shares the
      webhook handler.
- [x] **Worker** — idempotent maintenance pass (delayed quizzes, membership re-sync,
      cooldowns, referral qualification, reward unlocking, payouts) behind BullMQ.
- [x] **Mini App** — member area (home, learn, quiz, communities, rewards, invite,
      wallet, profile), creator dashboard (overview, quiz AI, revenue, settings) and
      platform administration.
- [x] **Tests** — unit, database-backed integration and Playwright browser tests;
      financial invariants under randomised input.
- [x] **Documentation** — architecture, API, deployment, and a manual testing guide.

## Next

- [ ] Real TON payouts: treasury signer, confirmation polling, reconciliation.
- [ ] TON Connect in the Mini App, so wallets are linked by `ton_proof` rather than
      by pasting an address.
- [ ] Revenue ingestion from a real source instead of manual entry.
- [ ] Fraud beyond the shared-wallet signal: velocity, answer-pattern similarity,
      coordinated join/leave detection, case workflow.
- [ ] Notifications: reward available, quiz published, membership at risk.
- [ ] Creator team invitations by link, and per-channel monetization reporting.
- [ ] Analytics over time (cohorts, retention curves) rather than point-in-time KPIs.
- [ ] Extracting the reward engine and AI pipeline into their own processes once
      load justifies it; the module boundaries already allow it.
