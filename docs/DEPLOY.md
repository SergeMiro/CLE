# Deployment

## What live mode requires

| variable | why |
| --- | --- |
| `APP_MODE=live` | disables the mock sign-in shortcut and the simulated Bot API |
| `TELEGRAM_BOT_TOKEN` | one bot serves every connected channel |
| `TELEGRAM_BOT_USERNAME` | used to build `t.me/<bot>/app?startapp=…` quiz links |
| `TELEGRAM_WEBHOOK_SECRET` | the only authentication Telegram offers on a webhook |
| `SESSION_SECRET` | 32+ random characters; signs nothing that is stored in clear |
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL 16+, Redis 7+ |
| `API_URL`, `MINI_APP_URL` | must be https; Telegram refuses anything else |
| `PLATFORM_ADMIN_TELEGRAM_IDS` | who may open `/admin` |

Optional but recommended: `AI_PROVIDER` + `AI_API_KEY` + `AI_MODEL` for real
quizzes, and `TON_*` for real payouts.

### A model that runs beside the app

Any OpenAI-compatible endpoint works, including one on the host itself:

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://host.docker.internal:47821/v1
AI_API_KEY=<the proxy's key>
AI_MODEL=<the model or routing alias it serves>
```

`host.docker.internal` resolves because the API and worker declare
`extra_hosts: host.docker.internal:host-gateway`. The endpoint has to listen on
an address the containers can reach — a proxy bound to `127.0.0.1` is invisible
to them — so keep the port closed at the firewall and keep its key set.

Configuration is validated at start-up. A missing live credential stops the
process rather than letting it run half-configured.

## With the Traefik already on this host

`deploy/docker-compose.yml` builds the monorepo once and runs PostgreSQL, Redis,
migrations, the API, the worker and the Mini App, attaching the two public
services to the external `infra_web` network with `websecure` + `myresolver`.

```bash
cp .env.example .env.production      # fill in the live values, plus:
#   POSTGRES_PASSWORD=…
#   API_HOST=cle-api.example.com
#   MINIAPP_HOST=cle.example.com
docker compose -f deploy/docker-compose.yml --env-file .env.production up -d --build
curl https://cle-api.example.com/health
pnpm --filter @cle/bot webhook:set https://cle-api.example.com/api/v1/telegram/webhook
```

Migrations run as a one-shot `migrate` service that the API waits for, so a
deploy can never start against an out-of-date schema.

The stack pins its Compose project name to `cle-prod`. Without that, Compose
derives the name from the directory, and two unrelated stacks that happen to sit
in directories with the same name share a namespace — where
`docker compose down --remove-orphans` in one deletes the other's containers.
The development stack in the repository root stays under the project `cle`, with
its own volumes and its own port bindings.

## Without a domain

```bash
cloudflared tunnel --url http://localhost:4101    # API
cloudflared tunnel --url http://localhost:4100    # Mini App
```

Put the two addresses into `API_URL` and `MINI_APP_URL`, restart, and register
the webhook against the API tunnel. Alternatively skip the webhook entirely and
run `pnpm bot:poll`, which long-polls Telegram and feeds updates through exactly
the same handler.

## TON payouts

Until a treasury is configured, withdrawals settle through the mock provider:
the ledger, the statuses and the audit trail are real, but no transaction is
broadcast. For real payouts set `TON_NETWORK`, `TON_RPC_URL`,
`TON_TREASURY_ADDRESS` and supply a signer to `HttpTonPayoutProvider` — the
signing key deliberately never enters CLE's domain code, so custody can later
move to a smart contract without changing the reward engine.

Start on `testnet`. A test-only address is rejected on mainnet and vice versa.

## Operational notes

- **Rate limits.** `RATE_LIMIT_MAX` (240/min) and `AUTH_RATE_LIMIT_MAX` (60/min)
  are per IP. Behind a proxy the API trusts `X-Forwarded-For`, so make sure the
  proxy sets it.
- **The worker must run.** Delayed quizzes, rejoin cooldowns, referral
  qualification, reward unlocking and payout processing all happen there. One
  pass is idempotent; `pnpm worker:once` runs it by hand.
- **Ledger health.** `/api/v1/admin/ledger/health` must report `balanced: true`
  and no negative custody accounts. Alert on it.
- **Backups.** The ledger is the source of truth for every balance; back up
  PostgreSQL, not Redis. Redis holds queues and rate limits only.
- **Secrets.** `.env.production` is git-ignored. Rotating `SESSION_SECRET`
  invalidates every session; rotating the bot token requires re-registering the
  webhook.

## What is deliberately not done yet

- TON payouts are mock until a treasury signer is configured.
- Telegram does not expose channel ad revenue through a public API, so revenue is
  entered by the creator (or an integration) and moves `OBSERVED → FUNDED` before
  it can be distributed. The state machine is built for a real feed to plug into.
- The `ton_proof` wallet flow is implemented and tested server-side; the Mini App
  currently links a wallet by address, which is why address linking is restricted
  to mock mode plus a verified proof path in live mode.
