import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encodeStartPayload, miniAppLink } from '@cle/telegram';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { userHome } from '../services/analytics.js';
import { communityBySlugOrId } from '../services/communities.js';
import { syncMembership } from '../services/membership.js';
import { getQuizForMember, listAvailableQuizzes, submitQuizAttempt } from '../services/quizzes.js';
import { linkWallet, listWallets, walletChallenges } from '../services/wallets.js';
import { listUserWithdrawals, requestUserWithdrawal } from '../services/withdrawals.js';

const submitSchema = z.object({
  answers: z.array(z.object({ questionId: z.uuid(), optionId: z.uuid() })).min(1).max(20),
});

const walletSchema = z.object({
  challengeId: z.uuid().optional(),
  address: z.string().min(10).max(80).optional(),
  proof: z
    .object({
      timestamp: z.number().int().positive(),
      domain: z.object({ lengthBytes: z.number().int().positive(), value: z.string().min(1).max(253) }),
      signature: z.string().min(10).max(200),
      payload: z.string().min(1).max(256),
      publicKeyHex: z.string().regex(/^[0-9a-fA-F]{64}$/),
      address: z.string().min(10).max(80),
    })
    .optional(),
});

const withdrawalSchema = z.object({
  amountNanoton: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  walletId: z.uuid().optional(),
});

/** Everything the member-facing Mini App needs, always scoped to the caller. */
export function registerMeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/me', async (request) => {
    const actor = requireActor(request);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    const organizations = await ctx.prisma.organizationMember.count({ where: { userId: actor.id } });
    return {
      id: user.id,
      telegramId: user.telegramId,
      username: user.telegramUsername,
      firstName: user.telegramFirstName,
      referralCode: user.referralCode,
      learningPoints: user.learningPoints,
      isPlatformAdmin: user.isPlatformAdmin,
      isCreator: organizations > 0,
    };
  });

  app.get('/api/v1/me/home', async (request) => userHome(ctx, requireActor(request).id));

  app.get('/api/v1/me/communities', async (request) => {
    const actor = requireActor(request);
    const memberships = await ctx.prisma.communityMember.findMany({
      where: { userId: actor.id },
      include: {
        community: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            memberCount: true,
            channel: { select: { username: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({
      membershipId: membership.id,
      status: membership.status,
      learningPoints: membership.learningPoints,
      quizzesCompleted: membership.quizzesCompleted,
      level: membership.loyaltyLevelKey,
      joinedAt: membership.currentJoinAt,
      community: membership.community,
    }));
  });

  app.get('/api/v1/communities/:identifier', async (request) => {
    const actor = request.actor;
    const { identifier } = z.object({ identifier: z.string().min(1).max(64) }).parse(request.params);
    const community = await communityBySlugOrId(ctx, identifier);
    const membership = actor
      ? await ctx.prisma.communityMember.findUnique({ where: { communityId_userId: { communityId: community.id, userId: actor.id } } })
      : null;
    return {
      id: community.id,
      name: community.name,
      slug: community.slug,
      description: community.description,
      memberCount: community.memberCount,
      status: community.status,
      channel: { title: community.channel.title, username: community.channel.username },
      membership: membership ? { status: membership.status, learningPoints: membership.learningPoints } : null,
    };
  });

  /** Asks Telegram whether the caller is really in the channel, and records the transition. */
  app.post('/api/v1/communities/:communityId/membership/sync', async (request) => {
    const actor = requireActor(request);
    const { communityId } = z.object({ communityId: z.uuid() }).parse(request.params);
    const result = await syncMembership(ctx, { communityId, userId: actor.id, source: 'ONBOARDING_CHECK' });
    return {
      status: result.member.status,
      changed: result.changed,
      telegramStatus: result.telegramStatus,
      learningPoints: result.member.learningPoints,
    };
  });

  app.get('/api/v1/me/quizzes', async (request) => {
    const actor = requireActor(request);
    const query = z.object({ communityId: z.uuid().optional() }).parse(request.query);
    return listAvailableQuizzes(ctx, actor.id, query.communityId);
  });

  app.get('/api/v1/quizzes/:quizId', async (request) => {
    const actor = requireActor(request);
    const { quizId } = z.object({ quizId: z.uuid() }).parse(request.params);
    return getQuizForMember(ctx, actor.id, quizId);
  });

  app.post('/api/v1/quizzes/:quizId/submit', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const actor = requireActor(request);
    const { quizId } = z.object({ quizId: z.uuid() }).parse(request.params);
    const body = submitSchema.parse(request.body);
    return submitQuizAttempt(ctx, actor.id, quizId, body.answers);
  });

  app.get('/api/v1/me/rewards', async (request) => {
    const actor = requireActor(request);
    const query = z.object({ communityId: z.uuid().optional(), status: z.string().max(20).optional() }).parse(request.query);
    return ctx.prisma.rewardAllocation.findMany({
      where: {
        userId: actor.id,
        ...(query.communityId ? { communityId: query.communityId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
      },
      include: { community: { select: { name: true, slug: true } }, cycle: { select: { periodStart: true, periodEnd: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/api/v1/me/referrals', async (request) => {
    const actor = requireActor(request);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { referralCode: true } });
    const referrals = await ctx.prisma.referral.findMany({
      where: { referrerUserId: actor.id },
      include: { community: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const link = (communityId?: string): string =>
      ctx.env.TELEGRAM_BOT_USERNAME
        ? miniAppLink({
            botUsername: ctx.env.TELEGRAM_BOT_USERNAME,
            appName: ctx.env.TELEGRAM_MINI_APP_NAME,
            payload: { kind: 'referral', referralCode: user.referralCode, ...(communityId ? { communityId } : {}) },
          })
        : `${ctx.env.MINI_APP_URL}?startapp=${encodeStartPayload({ kind: 'referral', referralCode: user.referralCode, ...(communityId ? { communityId } : {}) })}`;

    const memberships = await ctx.prisma.communityMember.findMany({
      where: { userId: actor.id, status: { in: ['ACTIVE', 'REJOIN_COOLDOWN'] } },
      include: { community: { select: { id: true, name: true } } },
    });

    return {
      referralCode: user.referralCode,
      platformLink: link(),
      communityLinks: memberships.map((membership) => ({
        communityId: membership.communityId,
        communityName: membership.community.name,
        link: link(membership.communityId),
      })),
      referrals: referrals.map((referral) => ({
        id: referral.id,
        scope: referral.scope,
        status: referral.status,
        community: referral.community,
        createdAt: referral.createdAt,
        qualifiedAt: referral.qualifiedAt,
      })),
    };
  });

  app.get('/api/v1/me/wallets', async (request) => listWallets(ctx, requireActor(request).id));

  app.post('/api/v1/me/wallets/challenge', async (request) => {
    const actor = requireActor(request);
    const challenge = walletChallenges.issue(actor.id, ctx.now());
    return { challengeId: challenge.id, nonce: challenge.nonce, expiresAt: challenge.expiresAt };
  });

  app.post('/api/v1/me/wallets', async (request) => {
    const actor = requireActor(request);
    const body = walletSchema.parse(request.body);
    return linkWallet(ctx, {
      userId: actor.id,
      ...(body.challengeId ? { challengeId: body.challengeId } : {}),
      ...(body.proof ? { proof: body.proof } : {}),
      ...(body.address ? { address: body.address } : {}),
    });
  });

  app.get('/api/v1/me/withdrawals', async (request) => listUserWithdrawals(ctx, requireActor(request).id));

  app.post('/api/v1/me/withdrawals', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request) => {
    const actor = requireActor(request);
    const body = withdrawalSchema.parse(request.body);
    return requestUserWithdrawal(ctx, actor, {
      amountNanoton: BigInt(body.amountNanoton),
      ...(body.walletId ? { walletId: body.walletId } : {}),
    });
  });

  app.get('/api/v1/me/ledger', async (request) => {
    const actor = requireActor(request);
    const entries = await ctx.prisma.ledgerEntry.findMany({
      where: { account: { ownerId: actor.id, type: { in: ['USER_AVAILABLE', 'USER_PENDING', 'USER_LOCKED'] } } },
      include: { account: { select: { type: true } }, transaction: { select: { kind: true, reference: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (entries.length === 0) {
      const user = await ctx.prisma.user.findUnique({ where: { id: actor.id }, select: { id: true } });
      if (!user) throw notFound('user not found');
    }
    return entries;
  });
}
