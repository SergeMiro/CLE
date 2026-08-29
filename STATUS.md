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
  `AI_API_KEY` for real ones.
- **Wallets are linked by address in mock mode.** `ton_proof` verification is
  implemented and tested server-side; the Mini App does not yet run TON Connect.
- **No live Telegram run yet.** Everything above was exercised against the
  simulated Bot API and in the browser. `docs/TESTING.md` is the step-by-step
  procedure for a real bot and a real test channel.
