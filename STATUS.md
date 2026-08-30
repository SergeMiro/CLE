# Status

**The whole platform is built and runs end to end.** A creator connects a channel,
a post becomes an AI quiz, members answer it, revenue is split, rewards are
calculated and paid, and a member withdraws to TON — verified by automated tests
and by hand in the browser.

## Verified

| gate | result |
| --- | --- |
| `pnpm typecheck` | 12/12 packages |
| `pnpm test` | 21/21 tasks, 217 unit tests |
| `pnpm test:integration` | 53 tests against real PostgreSQL |
| `pnpm test:e2e` | 11 Playwright tests in a real browser |
| `pnpm build` | 12/12 packages, Mini App builds clean |

The integration suite walks a full cycle and asserts the exact numbers from the
specification: 100 TON gross → 10 CLE fee → 4.5 creator (5% of the remainder) →
85.5 community → growth 29.925 / loyalty 34.2 / referral 12.825 / learning 8.55,
with a balanced ledger after every step.

## Honest limits

- **TON payouts are mock.** No treasury key is configured, so withdrawals settle
  through `MockTonPayoutProvider`: the ledger, statuses and audit trail are real,
  the transaction is not. Real payouts need `TON_RPC_URL`, `TON_TREASURY_ADDRESS`
  and a signer.
- **Telegram revenue is entered, not fetched.** Telegram exposes no public API for
  channel ad revenue. The `OBSERVED → CONFIRMED → FUNDED → DISTRIBUTED` state
  machine is built for a real feed; today a creator (or a script) records it.
- **The AI is only as good as its provider.** With no key the offline generator
  produces structurally valid but shallow quizzes. Set `AI_PROVIDER` and
  `AI_API_KEY` for real ones. The deployment on this host answers through a local
  OpenAI-compatible failover proxy, so a quiz costs nothing and a dead model is
  retried on another one.
- **A wallet is linked by a signed `ton_proof`, and the proof is tied to the
  account.** Nonce, domain, freshness and signature are checked, and then the
  wallet's state init is hashed: an account's address *is* that hash, and the
  signing key has to appear inside it. A throw-away key naming somebody else's
  address is refused.

## Live run, 30 August 2026

The platform was run end to end on the real deployment (`cle.smiro.dev`,
`@create_learn_earn_bot`, `APP_MODE=live`) with one client — `@sdartagnan`,
owner of `@kotiik_uchenyi` and `@techinsider360fr` — and CLE itself owned by
`@sergemiro`. A channel post became a published quiz in the channel (both
immediately and on a two-minute delay picked up by the worker), a real
subscriber answered it, 100 TON split 10 / 4.5 / 85.5, the pools came out at
29.925 / 34.2 / 12.825 / 8.55, a member and the creator both withdrew, and the
ledger balanced to zero after every step. Two defects were found and fixed in
that run: the Mini App was serving a build-time configuration (it claimed mock
mode on testnet in production), and a partial policy update silently reset the
rest of a community's settings.

Since that run the Mini App counts in CLE points — 1 000 CLEP to the TON, a
display unit over the same nanoton ledger, switchable by tapping the balance and
remembered per person.

A third defect came out of the same run and is fixed here: a `ton_proof` was
accepted without any link between the key that signed it and the address it
named, so a freshly generated key could register somebody else's wallet as the
payout address. The proof now has to carry the wallet's state init, and it is
checked against both the address and the key — verified live against real v4R2
and W5 wallets.
