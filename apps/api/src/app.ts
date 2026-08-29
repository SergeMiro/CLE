import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { TelegramInitDataError } from '@cle/telegram';
import type { TelegramAuthService } from './auth.js';

export interface ApiOptions { auth: TelegramAuthService; sessionSecret: string; production?: boolean; }

export async function createApi(options: ApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cookie, { secret: options.sessionSecret });
  await app.register(rateLimit, { global: false });
  app.get('/health', async () => ({ status: 'ok' }));
  app.post<{ Body: { initData?: string } }>('/api/v1/auth/telegram', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!request.body?.initData) return reply.code(400).send({ error: 'initData is required' });
    try {
      const user = await options.auth.authenticate(request.body.initData);
      reply.setCookie('cle_session', user.id, { httpOnly: true, secure: options.production ?? false, sameSite: 'strict', path: '/', signed: true, maxAge: 60 * 60 });
      return { user: { id: user.id, telegramId: user.telegramId.toString() } };
    } catch (error) {
      if (error instanceof TelegramInitDataError) return reply.code(401).send({ error: error.message });
      throw error;
    }
  });
  return app;
}

