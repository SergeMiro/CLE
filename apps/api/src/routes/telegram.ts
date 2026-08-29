import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TelegramUpdate } from '@cle/telegram';
import type { AppContext } from '../context.js';
import { handleTelegramUpdate } from '../services/telegram-webhook.js';

function secretMatches(supplied: string | undefined, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerTelegramRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Telegram delivers every update here. The secret header is the only
   * authentication Telegram offers, so it is required whenever it is configured
   * — and it always is in live mode.
   */
  app.post('/api/v1/telegram/webhook', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const expected = ctx.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected && !secretMatches(request.headers['x-telegram-bot-api-secret-token'] as string | undefined, expected)) {
      return reply.code(401).send({ error: 'invalid webhook secret' });
    }
    const update = request.body as TelegramUpdate;
    if (!update || typeof update.update_id !== 'number') return reply.code(400).send({ error: 'not a Telegram update' });

    // Telegram retries anything that is not answered quickly, so failures are
    // recorded on the WebhookEvent row rather than returned as an error.
    const outcome = await handleTelegramUpdate(ctx, update);
    request.log.info({ outcome }, 'telegram update processed');
    return { ok: true, ...outcome };
  });
}
