import { loadEnvironment } from '@cle/config';
import { buildContext } from '@cle/api';
import { ALLOWED_UPDATES, runPolling } from './polling.js';

const command = process.argv[2] ?? 'poll';
const env = loadEnvironment();
const ctx = buildContext({ env });

async function whoami(): Promise<void> {
  const me = await ctx.telegram.getMe();
  console.log(JSON.stringify(me, null, 2));
}

async function setWebhook(): Promise<void> {
  const url = process.argv[3] ?? `${env.API_URL}/api/v1/telegram/webhook`;
  if (!env.TELEGRAM_WEBHOOK_SECRET) throw new Error('TELEGRAM_WEBHOOK_SECRET must be set before registering a webhook');
  if (!url.startsWith('https://')) throw new Error('Telegram only delivers webhooks to an https url');
  await ctx.telegram.setWebhook(url, env.TELEGRAM_WEBHOOK_SECRET, ALLOWED_UPDATES);
  console.log(`[bot] webhook registered at ${url}`);
}

async function deleteWebhook(): Promise<void> {
  await ctx.telegram.deleteWebhook();
  console.log('[bot] webhook removed; long polling can now be used');
}

async function poll(): Promise<void> {
  // Telegram refuses getUpdates while a webhook is registered.
  await ctx.telegram.deleteWebhook().catch(() => undefined);
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`[bot] ${signal} received, stopping`);
      controller.abort();
    });
  }
  console.log(`[bot] polling Telegram in ${env.APP_MODE} mode`);
  await runPolling(ctx, { signal: controller.signal });
}

const commands: Record<string, () => Promise<void>> = {
  whoami,
  poll,
  'webhook:set': setWebhook,
  'webhook:delete': deleteWebhook,
};

const handler = commands[command];
if (!handler) {
  console.error(`unknown command "${command}". Use one of: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

await handler();
await ctx.prisma.$disconnect();
process.exit(0);
