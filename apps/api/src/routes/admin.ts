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
}
