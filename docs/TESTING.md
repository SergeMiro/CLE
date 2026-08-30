# Как проверить CLE руками

Два уровня. Сначала — локально, без единого секрета: всё работает на симуляторах,
и это правда весь продукт, а не заглушка. Потом — на настоящем боте и настоящем
тестовом канале, созданном под другим Telegram-аккаунтом.

---

## Уровень 1. Локально, `APP_MODE=mock`

Здесь нет ни бота, ни блокчейна, ни модели: Bot API, TON и AI подменены
симуляторами. Всё остальное — реальное: та же база, тот же реестр (ledger), тот
же движок наград, тот же API.

### 1.1. Поднять

```bash
cd ~/CLE
docker compose up -d                 # PostgreSQL :5432, Redis :6380
cp .env.example .env                 # SESSION_SECRET — 32+ случайных символа
pnpm install
pnpm db:deploy
pnpm seed:demo                       # соберёт демо-мир и напечатает ссылки

pnpm --filter @cle/api dev           # API   → http://localhost:4101
pnpm --filter @cle/miniapp dev       # Mini App → http://localhost:4100
```

`seed:demo` создаёт: канал «Science Daily», сообщество, четырёх участников, два
опубликованных квиза, доход 100 TON, закрытый цикл и выплаченные награды.

**Если браузер на другой машине** (например, VPS + Tailscale), запускайте оба
сервиса с адресом, который видит браузер — иначе Mini App будет стучаться в
`localhost` вашего компьютера, а Next в dev-режиме отклонит чужой источник:

```bash
HOST=<адрес сервера, видимый браузеру>   # LAN, tailnet или туннель
API_URL=http://$HOST:4101 MINI_APP_URL=http://$HOST:4100 \
  pnpm --filter @cle/api dev
API_URL=http://$HOST:4101 MINI_APP_URL=http://$HOST:4100 DEV_ORIGINS=$HOST \
  pnpm --filter @cle/miniapp dev
```

и открывать `http://$HOST:4100?mockUser=…`.

### 1.2. Что открыть

Вне Telegram Mini App принимает `?mockUser=<telegram id>` вместо подписи —
в `APP_MODE=live` этот путь недоступен физически.

| роль | ссылка |
| --- | --- |
| участник (уже с балансом) | `http://localhost:4100?mockUser=111000101` |
| новый участник (квизы не пройдены) | `http://localhost:4100/learn?mockUser=111000104` |
| креатор | `http://localhost:4100/creator?mockUser=111000001` |
| админ платформы | `http://localhost:4100/admin?mockUser=111000900` |

Админом становится тот, чей Telegram ID указан в `PLATFORM_ADMIN_TELEGRAM_IDS`.

### 1.3. Что проверить

**Участник.** На главной — общий баланс и разбивка по сообществам. `Learn` →
открыть квиз → ответить → сервер посчитает очки, покажет правильные ответы и
пояснения. Повторная попытка того же квиза отклоняется. `Wallet` → вставить
TON-адрес (`0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8`)
→ запросить вывод. `Invite` → ссылки-приглашения, отдельные для каждого
сообщества.

**Креатор** (`/creator`). Виден баланс креатора, валовый доход, комиссия CLE и
доля сообщества — ровно 10 / 4.5 / 85.5 на 100 TON при доле креатора 5%.
`Manage community` → четыре вкладки:
- *Overview* — участники, удержание, обучение, деньги;
- *Quiz AI* — включить/выключить, режим MANUAL/AUTO, число вопросов, задержка;
  ниже список постов (кнопка «Make quiz») и квизов (кнопка «Publish»);
- *Revenue* — записать доход за период, профинансировать и разделить одной
  кнопкой, затем «Calculate rewards» → «Approve and pay out»;
- *Settings* — ползунок доли креатора (выше платформенного лимита не поднимется)
  и доли четырёх пулов (обязаны давать 100%).

**Админ платформы** (`/admin`). Казна CLE, строка «Ledger balances to zero across
every account» — это проверка того, что деньги не появились и не исчезли.
Вкладки: выводы (кнопка «Send payout»), организации, расход на AI.

### 1.4. Проверить сходимость денег

```bash
pnpm worker:once      # один проход фоновых задач, печатает отчёт
```

В `/admin` реестр обязан оставаться сбалансированным после любых операций.

### 1.5. Автотесты

```bash
pnpm typecheck && pnpm test          # 200+ модульных тестов, без инфраструктуры
pnpm test:integration                # реальный PostgreSQL: весь жизненный цикл
pnpm test:e2e                        # Playwright: Mini App в браузере
```

---

## Уровень 2. Настоящий бот и тестовый канал

Здесь нужен публичный HTTPS: Telegram открывает Mini App только по https и
доставляет вебхуки только на https.

### 2.1. Создать бота

1. `@BotFather` → `/newbot` → имя и username → **токен**.
2. `/newapp` → выбрать бота → короткое имя приложения **`app`** → URL Mini App
   (см. ниже) → бот получит ссылку `https://t.me/<bot>/app`.
3. `/setjoingroups` → *Disable* (боту не нужны группы).

Короткое имя `app` не случайно: ссылки на квизы CLE строит как
`https://t.me/<bot>/app?startapp=q_<id>`.

### 2.2. Выложить наружу

На этом сервере уже есть Traefik (сеть `infra_web`, entrypoint `websecure`,
резолвер `myresolver`) и wildcard `*.smiro.dev` → этот VPS, поэтому достаточно:

```bash
cd ~/CLE
cp .env.example .env.production
# в .env.production:
#   NODE_ENV=production
#   APP_MODE=live
#   DATABASE_URL=postgresql://cle:<пароль>@postgres:5432/cle?schema=public
#   REDIS_URL=redis://redis:6379
#   API_URL=https://cle-api.smiro.dev
#   MINI_APP_URL=https://cle.smiro.dev
#   TELEGRAM_BOT_TOKEN=...
#   TELEGRAM_BOT_USERNAME=...
#   TELEGRAM_WEBHOOK_SECRET=<32+ случайных символа>
#   SESSION_SECRET=<32+ случайных символа>
#   PLATFORM_ADMIN_TELEGRAM_IDS=<ваш telegram id>
#   POSTGRES_PASSWORD=<тот же пароль>
#   API_HOST=cle-api.smiro.dev
#   MINIAPP_HOST=cle.smiro.dev

docker compose -f deploy/docker-compose.yml --env-file .env.production up -d --build
```

Проверить: `curl https://cle-api.smiro.dev/health` → `{"status":"ok","mode":"live"}`.

Альтернатива без домена — туннель:

```bash
cloudflared tunnel --url http://localhost:4101   # для API
cloudflared tunnel --url http://localhost:4100   # для Mini App
```

и подставить выданные адреса в `API_URL` / `MINI_APP_URL`.

### 2.3. Зарегистрировать вебхук

```bash
pnpm --filter @cle/bot webhook:set https://cle-api.smiro.dev/api/v1/telegram/webhook
pnpm --filter @cle/bot whoami        # убедиться, что токен живой
```

Если публичного адреса пока нет — можно вообще без вебхука:

```bash
pnpm bot:poll     # длинный опрос, апдейты идут через тот же обработчик
```

Mini App при этом всё равно нужен https, а бот и канал будут работать.

### 2.4. Создать тестовый канал под другим аккаунтом

Это ключевой момент: канал должен принадлежать **другому** человеку — так
проверяется, что платформа мультиарендная, а не «бот одного владельца».

Со второго аккаунта (второй телефон, второй Telegram):

1. Создать канал, например `CLE Test Lab`, публичный, username `cle_test_lab`
   (публичный проще: не нужен числовой chat id).
2. Настройки канала → *Администраторы* → добавить вашего бота.
3. Выдать права: **Post messages** обязательно; желательно также Edit messages,
   Delete messages, Add subscribers — без них канал получит статус `DEGRADED`,
   и CLE честно об этом скажет.

Если канал приватный, узнать его `chat_id`: переслать любой пост из канала боту
`@userinfobot` — он покажет id вида `-100…`; его и вставлять вместо `@username`.

### 2.5. Подключить канал в CLE

Со **второго** аккаунта (владельца канала) открыть Mini App: `https://t.me/<bot>/app`.

1. `Profile` → `Creator dashboard` → *Start as a creator* → название организации.
2. *Connect a channel* → `@cle_test_lab` → должно появиться
   «Channel verified — the bot has everything it needs».
   Если написано, что бот не администратор — вернуться в п. 2.4.
3. *Create community* → затем *Launch community*.
4. `Manage community` → *Quiz AI* → режим `AUTO`, 3 вопроса, задержка 0 →
   *Save and enable*.

### 2.6. Настоящий AI (иначе квизы будут формальными)

Без ключа работает встроенный офлайн-генератор: структура правильная, вопросы
примитивные. Для нормальных вопросов в `.env.production`:

```
AI_PROVIDER=openrouter        # или gemini / anthropic / openai-compatible
AI_MODEL=<модель>
AI_API_KEY=<ключ>
```

и перезапустить: `docker compose -f deploy/docker-compose.yml up -d api worker`.

### 2.7. Прогнать полный цикл

1. **Пост.** Со второго аккаунта опубликовать в канале осмысленный текст
   (200+ символов, иначе политика его пропустит — так и задумано).
   Через несколько секунд бот сам публикует в канал карточку
   `TEST YOUR KNOWLEDGE` с кнопкой `START QUIZ`.
2. **Подписка.** С первого аккаунта (и с любых других) подписаться на канал.
3. **Квиз.** Нажать `START QUIZ` → откроется Mini App → ответить.
   Если вы не подписаны на канал, сервер откажет: «join the channel to earn
   XP» — это и есть проверка членства.
4. **Членство.** В Mini App → `Communities` → сообщество → *Check my membership*.
   Выйти из канала и нажать снова: статус станет `LEFT`. Вернуться — `REJOIN_COOLDOWN`
   (защита от выхода-входа ради наград).
5. **Доход.** Креатор → `Manage community` → *Revenue* → сумма (например `10`),
   период → *Record, fund and split*. Появится цикл с разбивкой
   «CLE fee / your share / community share».
6. **Награды.** В той же карточке *Calculate rewards* → *Approve and pay out*.
   Участники увидят баланс на главной; в `Rewards` — из какого пула он пришёл.
   ⚠️ Участник моложе `newMemberHoldDays` (по умолчанию 7 дней) не получит доли
   growth и loyalty — это не баг, а защита от накрутки. Чтобы увидеть выплату
   сразу, поставьте `newMemberHoldDays: 0` в политике наград сообщества.
7. **Вывод.** Участник → `Wallet` → вставить адрес TON → сумма → *Withdraw to TON*.
   Админ платформы → `/admin` → *Withdrawals* → *Send payout*.
   ⚠️ Пока `TON_RPC_URL`, `TON_TREASURY_ADDRESS` и подписант не настроены,
   выплата исполняется мок-провайдером: статусы и реестр реальные, транзакции в
   сети нет.
8. **Реферал.** Участник → `Invite` → скопировать ссылку сообщества → открыть с
   третьего аккаунта → подписаться на канал. Реферал станет `QUALIFIED` через
   `referralQualificationDays` (по умолчанию 30 дней) и попадёт в referral-пул.

### 2.8. На что смотреть, чтобы поверить

- `/admin` → «Ledger balances to zero across every account» после каждой операции.
- `/admin` → *Withdrawals* — статусы `LOCKED → PROCESSING → CONFIRMED`.
- Сумма `CLE fee + creator share + community share` всегда равна валовому доходу.
- Второй креатор со своим каналом не видит ни первого сообщества, ни его денег:
  запрос к чужому ресурсу возвращает `404`, а не `403`.

---

## Частые проблемы

| симптом | причина |
| --- | --- |
| «CLE cannot read that channel» | бот не добавлен в канал администратором |
| канал в статусе `DEGRADED` | у бота отобрали право `can_post_messages` |
| пост не превратился в квиз | текст короче `minimumPostLength`, исчерпан дневной лимит, или AI-политика выключена |
| квиз в статусе `REVIEW` | не прошёл порог качества; опубликовать вручную во вкладке *Quiz AI* |
| «join the channel to earn XP» | аккаунт не состоит в канале |
| награда 0 у нового участника | не истёк `newMemberHoldDays` |
| Mini App не открывается из Telegram | адрес не https или короткое имя приложения не `app` |
| «too many requests» | лимит запросов; поднять `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` |
