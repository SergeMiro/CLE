import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { MoneyError } from '@cle/core';
import { LedgerError } from '@cle/ledger';
import { RewardEngineError } from '@cle/reward-engine';
import { DeepLinkError, TelegramApiError, TelegramInitDataError } from '@cle/telegram';
import { TonAddressError, TonPayoutError, TonProofError } from '@cle/ton';
import { QuizGenerationError } from '@cle/ai';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';
import { registerAuth } from './plugins/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCreatorRoutes } from './routes/creator.js';
import { registerMeRoutes } from './routes/me.js';
import { registerTelegramRoutes } from './routes/telegram.js';
import { serialize } from './serialization.js';

export interface CreateApiOptions {
  ctx: AppContext;
  logger?: boolean;
}

export async function createApi({ ctx, logger = true }: CreateApiOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { level: ctx.env.LOG_LEVEL } : false,
    // Prisma returns BigInt for money; the serializer renders it as a string.
    serializerOpts: { rounding: 'trunc' },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: [ctx.env.MINI_APP_URL, /\.telegram\.org$/, /^https:\/\/web\.telegram\.org$/],
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-cle-session'],
  });
  await app.register(rateLimit, { global: false, max: ctx.env.RATE_LIMIT_MAX, timeWindow: '1 minute' });

  app.setSerializerCompiler(() => (data) => JSON.stringify(serialize(data)));
  app.addHook('preSerialization', async (_request, _reply, payload) => serialize(payload));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'bad_request', message: 'request validation failed', details: error.issues });
    }
    if (error instanceof TelegramInitDataError || error instanceof TonProofError) {
      return reply.code(401).send({ error: 'unauthorized', message: error.message });
    }
    if (
      error instanceof MoneyError ||
      error instanceof LedgerError ||
      error instanceof RewardEngineError ||
      error instanceof TonAddressError ||
      error instanceof TonPayoutError ||
      error instanceof DeepLinkError ||
      error instanceof QuizGenerationError
    ) {
      return reply.code(422).send({ error: 'unprocessable', message: error.message });
    }
    if (error instanceof TelegramApiError) {
      return reply.code(502).send({ error: 'telegram_unavailable', message: error.message });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: 'too many requests' });
    }
    // Prisma's "record not found" for findUniqueOrThrow.
    if ((error as { code?: string }).code === 'P2025') {
      return reply.code(404).send({ error: 'not_found', message: 'not found' });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return reply.code(409).send({ error: 'conflict', message: 'that record already exists' });
    }
    // Fastify's own errors (a malformed body, an unsupported content type)
    // already carry the right 4xx; reporting them as 500 blames the server for
    // what the caller sent, and hides the real cause from the client.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      request.log.warn({ err: error }, 'client error');
      const message = error instanceof Error ? error.message : 'the request could not be read';
      return reply.code(statusCode).send({ error: 'bad_request', message });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error', message: 'something went wrong' });
  });

  app.get('/health', async () => ({
    status: 'ok',
    mode: ctx.env.APP_MODE,
    network: ctx.env.TON_NETWORK,
    aiProvider: ctx.ai.name,
    time: ctx.now().toISOString(),
  }));

  registerAuth(app, ctx);
  registerAuthRoutes(app, ctx);
  registerMeRoutes(app, ctx);
  registerCreatorRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerTelegramRoutes(app, ctx);

  return app;
}
