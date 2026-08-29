import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireActor } from '../plugins/auth.js';
import { issueSession, revokeSession, upsertTelegramUser, verifyIdentity } from '../services/identity.js';
import { recordReferral, resolveReferrer } from '../services/referrals.js';
import { decodeStartPayload } from '@cle/telegram';

const bodySchema = z.object({
  initData: z.string().min(1).max(4096),
  /** Raw Telegram start parameter, so a referral or a quiz link is attributed at sign-in. */
  startParam: z.string().max(64).optional(),
});

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/v1/auth/telegram', { config: { rateLimit: { max: ctx.env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request) => {
    const body = bodySchema.parse(request.body);
    const identity = verifyIdentity(ctx, body.initData);

    const user = await upsertTelegramUser(ctx, identity);
    const payload = body.startParam ? decodeStartPayload(body.startParam) : undefined;
    if (payload?.kind === 'referral') {
      const referrerId = await resolveReferrer(ctx, payload.referralCode);
      if (referrerId) {
        await recordReferral(ctx, {
          referrerUserId: referrerId,
          referredUserId: user.id,
          ...(payload.communityId ? { communityId: payload.communityId } : {}),
        });
      }
    }

    const session = await issueSession(ctx, user.id, {
      userAgent: request.headers['user-agent'],
      ipHash: undefined,
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      startPayload: payload ?? null,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        username: user.telegramUsername,
        firstName: user.telegramFirstName,
        referralCode: user.referralCode,
        isPlatformAdmin: user.isPlatformAdmin,
        learningPoints: user.learningPoints,
      },
    };
  });

  app.post('/api/v1/auth/logout', async (request) => {
    requireActor(request);
    if (request.sessionToken) await revokeSession(ctx, request.sessionToken);
    return { ok: true };
  });
}
