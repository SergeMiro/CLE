# API reference

Base URL: `${API_URL}/api/v1`. Every response is JSON; every amount is a decimal
string of nanotons (1 TON = 1 000 000 000 nanoton).

## Authentication

```http
POST /api/v1/auth/telegram
{ "initData": "<Telegram.WebApp.initData>", "startParam": "q_ab12…" }
→ { "token": "...", "expiresAt": "...", "user": {...}, "startPayload": {...} }
```

Send the token on every other request:

```
Authorization: Bearer <token>
```

In `APP_MODE=mock` the `initData` field also accepts `mock:<telegramId>[:username]`.
That shortcut does not exist in live mode.

`POST /api/v1/auth/logout` revokes the session.

## Member

| method | path | purpose |
| --- | --- | --- |
| GET | `/me` | profile, referral code, whether they are a creator or admin |
| GET | `/me/home` | global balance, per-community breakdown, points, open quizzes |
| GET | `/me/communities` | every membership with status and points |
| GET | `/communities/:slugOrId` | one community and the caller's membership |
| POST | `/communities/:communityId/membership/sync` | re-check membership with Telegram |
| GET | `/me/quizzes` | the learning feed across every community (`?communityId=`) |
| GET | `/quizzes/:quizId` | one quiz — questions and options, never the answer key |
| POST | `/quizzes/:quizId/submit` | submit answers; scored on the server |
| GET | `/me/rewards` | allocation history (`?status=`, `?communityId=`) |
| GET | `/me/referrals` | referral code, per-community invite links, invited people |
| GET/POST | `/me/wallets` | list or link a TON wallet |
| POST | `/me/wallets/challenge` | issue a single-use `ton_proof` nonce |
| GET/POST | `/me/withdrawals` | withdrawal history, request a payout |
| GET | `/me/ledger` | the caller's own ledger entries |

## Creator

| method | path | purpose |
| --- | --- | --- |
| GET/POST | `/organizations` | list or create an organization |
| GET | `/organizations/:id/overview` | revenue, fee, creator and community shares, members |
| POST | `/organizations/:id/members` | add a team member with a role |
| POST | `/organizations/:id/wallet` | set the payout wallet |
| POST | `/organizations/:id/withdrawals` | withdraw the creator balance |
| GET/POST | `/organizations/:id/channels` | list channels, connect one and verify the bot |
| POST | `/channels/:id/verify` | re-check the bot's permissions |
| POST | `/channels/:id/monetization` | enable, pause or disable monetization |
| GET/POST | `/organizations/:id/communities`, `/communities` | list or create a community |
| POST | `/communities/:id/launch` | make a community live |
| GET | `/communities/:id/analytics` | membership, learning, referral and money KPIs |
| GET | `/communities/:id/policies` | platform, revenue, reward and quiz policy in force |
| POST | `/communities/:id/policies/revenue` | new creator-share version |
| POST | `/communities/:id/policies/reward` | new pool-share version |
| POST | `/communities/:id/policies/quiz` | new AI quiz policy version |
| GET | `/communities/:id/content` | ingested channel posts and their quizzes |
| GET | `/communities/:id/quizzes` | quizzes with question and attempt counts |
| POST | `/content/:id/quiz` | generate a quiz from one post |
| POST | `/quizzes/:id/approve`, `/quizzes/:id/publish` | approve and post the call to action |
| POST | `/communities/:id/revenue` | record a revenue entry |
| POST | `/revenue/:id/status` | confirm, fund or cancel it |
| GET/POST | `/communities/:id/revenue-cycles` | list cycles, or close a period and split it |
| POST | `/revenue-cycles/:id/reward-cycle` | open the reward cycle |
| POST | `/reward-cycles/:id/calculate` | freeze eligibility and compute allocations |
| POST | `/reward-cycles/:id/approve` | approve the calculation |
| POST | `/reward-cycles/:id/finalize` | post to the ledger and release the rewards |
| GET | `/reward-cycles/:id` | pools, allocations and snapshot count |
| POST | `/reward-allocations/:id/cancel` | return a pending allocation to the community |

Roles: `OWNER` everything · `ADMIN` operations · `FINANCE` revenue, rewards and
payouts · `EDITOR` content and quizzes · `ANALYST` read-only analytics.

## Platform administration

| method | path | purpose |
| --- | --- | --- |
| GET | `/admin/overview` | platform-wide money and activity |
| GET | `/admin/ledger/health` | net across every account and any negative custody |
| GET | `/admin/organizations` | every organization |
| GET/POST | `/admin/policy` | read or publish a new platform policy version |
| GET | `/admin/withdrawals` | every withdrawal (`?status=`) |
| POST | `/admin/withdrawals/:id/process` | send the payout |
| GET | `/admin/fraud` | fraud signals and cases |
| GET | `/admin/ai-usage` | token usage and estimated cost per provider and model |
| GET | `/admin/audit` | the audit log (`?entityType=`, `?entityId=`) |

## Telegram

```http
POST /api/v1/telegram/webhook
X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>
```

Handles `channel_post`, `my_chat_member`, `chat_member` and `/start`. Updates are
deduplicated by `update_id`, and the endpoint always answers `200` once the
update is recorded so Telegram does not retry a failure forever.

## Errors

```json
{ "error": "unprocessable", "message": "insufficient available balance" }
```

`400` validation · `401` no or expired session · `403` role not permitted ·
`404` not found, including another tenant's resource · `409` conflict, such as a
repeated quiz attempt · `422` a rule refused the request · `429` rate limited ·
`502` Telegram unavailable.
