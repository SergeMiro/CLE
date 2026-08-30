import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { platformOverview } from '../services/analytics.js';
import { recordAudit } from '../services/audit.js';
import { checkLedgerHealth } from '../services/ledger.js';
import { currentPlatformPolicy } from '../services/policies.js';
import { requirePlatformAdmin } from '../services/rbac.js';
import { processWithdrawal } from '../services/withdrawals.js';

/** Platform-level administration. It belongs to CLE, never to a creator. */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/admin/overview', async (request) => platformOverview(ctx, requireActor(request)));

  app.get('/api/v1/admin/ledger/health', async (request) => {
    requirePlatformAdmin(requireActor(request));
    return checkLedgerHealth(ctx);
  });

  app.get('/api/v1/admin/organizations', async (request) => {
    requirePlatformAdmin(requireActor(request));
    return ctx.prisma.organization.findMany({
      include: {
        owner: { select: { telegramUsername: true, telegramId: true } },
        _count: { select: { channels: true, communities: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/api/v1/admin/policy', async (request) => {
    requirePlatformAdmin(requireActor(request));
    return currentPlatformPolicy(ctx);
  });

  app.post('/api/v1/admin/policy', async (request) => {
    const actor = requireActor(request);
    requirePlatformAdmin(actor);
    const body = z
      .object({
        platformFeeBps: z.number().int().min(0).max(10_000),
        maxCreatorShareBps: z.number().int().min(0).max(10_000),
        minWithdrawalNanoton: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
        maxQuizzesPerDay: z.number().int().min(1).max(50),
        effectiveAt: z.iso.datetime().optional(),
      })
      .parse(request.body);
    if (body.platformFeeBps + body.maxCreatorShareBps > 10_000) throw badRequest('the fee and the creator cap cannot exceed 100%');

    const current = await currentPlatformPolicy(ctx);
    const created = await ctx.prisma.platformPolicy.create({
      data: {
        version: current.version + 1,
        platformFeeBps: body.platformFeeBps,
        maxCreatorShareBps: body.maxCreatorShareBps,
        minWithdrawalNanoton: BigInt(body.minWithdrawalNanoton),
        maxQuizzesPerDay: body.maxQuizzesPerDay,
        allowedPoolTypes: current.allowedPoolTypes,
        minPoolBps: current.minPoolBps,
        maxPoolBps: current.maxPoolBps,
        effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : ctx.now(),
      },
    });
    await recordAudit(ctx, {
      actorType: 'ADMIN',
      actorId: actor.id,
      action: 'platform.policy_updated',
      entityType: 'PlatformPolicy',
      entityId: created.id,
      before: { version: current.version, platformFeeBps: current.platformFeeBps },
      after: { version: created.version, platformFeeBps: created.platformFeeBps },
    });
    return created;
  });

  app.get('/api/v1/admin/withdrawals', async (request) => {
    requirePlatformAdmin(requireActor(request));
    const query = z.object({ status: z.string().max(20).optional() }).parse(request.query);
    return ctx.prisma.withdrawal.findMany({
      where: query.status ? { status: query.status as never } : {},
      include: {
        wallet: { select: { addressFriendly: true, network: true } },
        user: { select: { telegramUsername: true, telegramId: true } },
        organization: { select: { name: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
  });

  app.post('/api/v1/admin/withdrawals/:withdrawalId/process', async (request) => {
    requirePlatformAdmin(requireActor(request));
    const { withdrawalId } = z.object({ withdrawalId: z.uuid() }).parse(request.params);
    const result = await processWithdrawal(ctx, withdrawalId);
    return { status: result.withdrawal.status, txHash: result.txHash ?? null, error: result.error ?? null };
  });

  app.get('/api/v1/admin/fraud', async (request) => {
    requirePlatformAdmin(requireActor(request));
    const [signals, cases] = await Promise.all([
      ctx.prisma.fraudSignal.findMany({
        include: { user: { select: { telegramUsername: true, telegramId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      ctx.prisma.fraudCase.findMany({ orderBy: { openedAt: 'desc' }, take: 50 }),
    ]);
    return { signals, cases };
  });

  app.get('/api/v1/admin/ai-usage', async (request) => {
    requirePlatformAdmin(requireActor(request));
    const grouped = await ctx.prisma.aIUsage.groupBy({
      by: ['provider', 'model', 'operation'],
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicroUsd: true },
      _count: { _all: true },
    });
    return grouped;
  });

  app.get('/api/v1/admin/audit', async (request) => {
    requirePlatformAdmin(requireActor(request));
    const query = z.object({ entityType: z.string().max(40).optional(), entityId: z.string().max(64).optional() }).parse(request.query);
    return ctx.prisma.auditLog.findMany({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  /*
   * Sponsored slots. CLE sells the platform-wide ones; a community-scoped ad
   * belongs to one channel and outranks ours wherever it runs.
   */
  const adBody = z.object({
    scope: z.enum(['PLATFORM', 'COMMUNITY']).default('PLATFORM'),
    communityId: z.uuid().optional(),
    sponsor: z.string().min(1).max(60),
    headline: z.string().min(1).max(90),
    body: z.string().max(160).optional(),
    ctaLabel: z.string().max(24).optional(),
    url: z.url().max(500),
    status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']).default('DRAFT'),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    weight: z.number().int().min(1).max(100).default(1),
  });

  app.get('/api/v1/admin/ads', async (request) => {
    requirePlatformAdmin(requireActor(request));
    return ctx.prisma.advertisement.findMany({
      include: { community: { select: { name: true, slug: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  });

  app.post('/api/v1/admin/ads', async (request) => {
    const actor = requireActor(request);
    requirePlatformAdmin(actor);
    const body = adBody.parse(request.body);
    if (body.scope === 'COMMUNITY' && !body.communityId) throw badRequest('a community-scoped ad needs a communityId');
    if (body.startsAt && body.endsAt && new Date(body.startsAt) > new Date(body.endsAt)) {
      throw badRequest('the campaign ends before it starts');
    }
    const ad = await ctx.prisma.advertisement.create({
      data: {
        scope: body.scope,
        ...(body.scope === 'COMMUNITY' && body.communityId ? { communityId: body.communityId } : {}),
        sponsor: body.sponsor,
        headline: body.headline,
        ...(body.body ? { body: body.body } : {}),
        ...(body.ctaLabel ? { ctaLabel: body.ctaLabel } : {}),
        url: body.url,
        status: body.status,
        ...(body.startsAt ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt ? { endsAt: new Date(body.endsAt) } : {}),
        weight: body.weight,
        createdById: actor.id,
      },
    });
    await recordAudit(ctx, {
      actorType: 'USER',
      actorId: actor.id,
      action: 'ad.created',
      entityType: 'Advertisement',
      entityId: ad.id,
      after: { sponsor: ad.sponsor, scope: ad.scope, status: ad.status },
    });
    return ad;
  });

  app.post('/api/v1/admin/ads/:adId/status', async (request) => {
    const actor = requireActor(request);
    requirePlatformAdmin(actor);
    const { adId } = z.object({ adId: z.uuid() }).parse(request.params);
    const { status } = z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']) }).parse(request.body);
    const ad = await ctx.prisma.advertisement.update({ where: { id: adId }, data: { status } });
    await recordAudit(ctx, {
      actorType: 'USER',
      actorId: actor.id,
      action: 'ad.status',
      entityType: 'Advertisement',
      entityId: ad.id,
      after: { status },
    });
    return ad;
  });
}
