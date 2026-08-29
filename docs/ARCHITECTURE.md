# Architecture

CLE is a multi-tenant platform, not a bot with an owner. Every design decision
below exists to make a second creator a data row rather than a code change.

## The hierarchy

```
PLATFORM
   └── ORGANIZATION        the creator's account: team, wallets, policies, billing
         └── CHANNEL       one connected Telegram channel
               └── COMMUNITY   where membership, quizzes, referrals and rewards live
                     └── MEMBERS
```

A `User` is global. One person is a learner in several communities, a creator in
their own organization and possibly a platform administrator — with one identity,
one wallet and one balance. `CommunityMember` is the join between a user and a
community, and it is where per-community state (status, points, loyalty level)
belongs.

## The money

```
gross revenue
  → platform fee          PlatformPolicy.platformFeeBps (10% by default)
  → creator share         RevenuePolicy.creatorShareBps, applied to the remainder,
                          hard-capped by PlatformPolicy.maxCreatorShareBps
  → community share       everything left
       → reward pools     RewardPolicy: growth / loyalty / referral / learning
            → allocations per member
                 → ledger → withdrawal → TON
```

Three rules keep this honest:

1. **Integers only.** Every amount is a `BigInt` nanoton. There is no `Float` or
   `Decimal` anywhere in the schema, and a schema test asserts that.
2. **Nothing is lost or invented.** `splitRevenue` guarantees
   `fee + creator + community === gross`; the reward engine guarantees
   `allocated + carried === distributable`; both are covered by randomised tests.
3. **History is append-only.** Money moves through a double-entry ledger. Entries
   are never updated or deleted, transactions are keyed by a business reference
   so a replay is a no-op, and the sum of all account balances is always zero.

### Ledger accounts

| account | holds |
| --- | --- |
| `REVENUE_SOURCE` | origin of a community's revenue; goes negative as money enters |
| `PLATFORM_TREASURY` | the CLE fee |
| `CREATOR_BALANCE` | organization funds available to withdraw |
| `ORGANIZATION_TREASURY` | organization funds locked in a withdrawal |
| `COMMUNITY_TREASURY` | the community share, waiting to be allocated |
| `USER_PENDING` | allocated to a member, still on hold |
| `USER_AVAILABLE` | withdrawable member balance |
| `USER_LOCKED` | member funds locked in a withdrawal |
| `EXTERNAL_TON` | money that has left CLE custody on-chain |

`checkLedgerHealth` reports the net across every account and any custody account
that has gone negative. The platform admin screen shows it, and the end-to-end
test asserts it after every payout.

## Revenue states

Observed revenue is not money that can be paid out:

```
OBSERVED → CONFIRMED → FUNDED → DISTRIBUTED
```

Only `FUNDED` entries can enter a `RevenueCycle`, and only a split revenue cycle
can produce a `RewardCycle`.

## Reward cycles

```
RevenueCycle (SPLIT)
   → RewardCycle DRAFT
   → CALCULATED   immutable eligibility snapshot + pools + allocations
   → APPROVED     a human decision
   → FINALIZED    ledger postings; from here the cycle is history
```

`calculateRewardCycle` in `packages/reward-engine` is pure: it takes the
distributable amount, the policy and a list of members, and returns allocations.
It never touches the database, so it can be tested exhaustively and re-run
deterministically. A pool nobody qualifies for is *carried* back to the community
treasury, never silently spread across the others.

Eligibility rules, all applied at the end of the cycle period:

- growth and loyalty require an active member past the new-member hold and out of
  any rejoin cooldown;
- referral and learning are earned by action, so they are paid during the hold —
  but never to a member who has left or been blocked;
- loyalty weight comes from the community's tier table (age in days → weight).

## Policies

Configuration is a hierarchy with the platform on top:

```
PlatformPolicy  → what a creator may never exceed
RevenuePolicy   → the creator's share, per community
RewardPolicy    → pool shares, holds, loyalty tiers, minimum reward
QuizGenerationPolicy → AI mode, cadence, difficulty, quality threshold
```

Every one of them is versioned. A new version applies to future cycles only;
`RevenueCycle.policySnapshot` and `RewardCycle.policySnapshot` record exactly
which versions produced a given distribution.

## Telegram

One bot serves every channel. An inbound update is resolved to a tenant before
anything else happens:

```
update → chat id → TelegramChannel → Organization + Community
```

- `channel_post` → `ContentItem` → quiz pipeline
- `my_chat_member` → the bot's own rights changed → channel status ACTIVE / DEGRADED / DISCONNECTED
- `chat_member` → a subscriber joined or left → membership state machine
- `message` `/start` → referral attribution and a Mini App button

Updates are deduplicated on `(provider, externalId)`, so Telegram's redelivery
cannot double-count anything. `apps/bot` can also long-poll and feed updates into
the identical handler, which is how the whole flow is tested without a public
HTTPS endpoint.

Authentication is Telegram's signed `initData`: HMAC against the bot token plus a
freshness window. It is deliberately *not* single-use — Telegram hands the same
`initData` to every reload of a Mini App session.

## AI

`packages/ai` has no vendor in its domain code. `AIProvider` is an interface;
`HttpAIProvider` speaks OpenRouter, Gemini, Anthropic and any OpenAI-compatible
endpoint, and `MockAIProvider` writes a well-formed quiz offline so the pipeline
can run with no key at all.

```
content → language detection → normalisation → generation → schema validation
        → quality assessment → DRAFT (or REVIEW when the gate fails)
```

The quality gate scores structure (exactly one correct answer, plausible
distractors, explanations present, no repeat of an earlier quiz, questions
actually grounded in the post). In `AUTO` mode only a passing quiz is published
to the channel; anything else waits for the creator. Token usage and an estimated
cost are recorded per organization in `AIUsage`.

## Isolation

Tenant isolation is enforced in one place — `requireOrganizationAccess` and
`requireCommunityAccess` — and every route derives the tenant from the resource,
never from the request body. A creator asking about another creator's community
gets `404`, not `403`: they must not learn it exists. Organization roles are
`OWNER · ADMIN · EDITOR · ANALYST · FINANCE`, mapped to capabilities rather than
to routes.

Fraud detection deliberately works across tenants: one wallet used by one person
in many communities is normal, one wallet behind many accounts is a signal, and
only the platform can see that.

## Services and their seams

The API is a modular monolith — one process, clear module boundaries. The parts
that would be extracted first already live behind interfaces:

- the reward engine and the ledger are pure packages with no I/O;
- Telegram, TON and AI are provider interfaces with mock and HTTP implementations;
- `apps/worker` runs the scheduled work as one idempotent `runMaintenancePass`,
  wrapped in a BullMQ queue that can move to its own process or machine untouched;
- the payout layer is an abstraction, so custody can later move to a smart
  contract without the reward engine noticing.

## Testing

| level | what it proves |
| --- | --- |
| unit (`pnpm test`) | money arithmetic, ledger invariants, reward determinism, initData, ton_proof, quiz quality |
| integration (`pnpm test:integration`) | the real API against real PostgreSQL: the whole lifecycle, tenant isolation, database constraints, worker jobs, the bot bridge |
| browser (`pnpm test:e2e`) | the Mini App a person actually touches, against a freshly seeded world |

The end-to-end integration test walks one revenue cycle from a channel post to a
TON payout and asserts the exact split (10 / 4.5 / 85.5 on 100 TON), the pool
amounts, the member balance and a balanced ledger.
