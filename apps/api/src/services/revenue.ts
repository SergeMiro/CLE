import { splitRevenue } from '@cle/core';
import type { RevenueCycle, RevenueEntry } from '@cle/db';
import { revenueSplitTransaction } from '@cle/ledger';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound, unprocessable } from '../errors.js';
import { recordAudit } from './audit.js';
import { postTransaction } from './ledger.js';
import { currentPlatformPolicy, effectiveRevenuePolicy } from './policies.js';
import { type Actor, requireCommunityAccess } from './rbac.js';

export interface RecordRevenueInput {
  communityId: string;
  source: string;
  amountNanoton: bigint;
  periodStart: Date;
  periodEnd: Date;
  externalReference: string;
  metadata?: Record<string, unknown>;
}

/**
 * Revenue observed on a channel is not money CLE can pay out. It walks
 * OBSERVED -> CONFIRMED -> FUNDED, and only FUNDED revenue can create rewards.
 */
export async function recordRevenue(ctx: AppContext, actor: Actor, input: RecordRevenueInput): Promise<RevenueEntry> {
  const access = await requireCommunityAccess(ctx, actor, input.communityId, 'revenue:manage');
  if (input.amountNanoton <= 0n) throw badRequest('revenue amount must be positive');
  if (input.periodEnd <= input.periodStart) throw badRequest('the revenue period ends before it starts');
  const community = await ctx.prisma.community.findUniqueOrThrow({ where: { id: input.communityId }, select: { channelId: true } });

  const existing = await ctx.prisma.revenueEntry.findUnique({ where: { externalReference: input.externalReference } });
  if (existing) throw conflict(`revenue ${input.externalReference} has already been recorded`);

  const entry = await ctx.prisma.revenueEntry.create({
    data: {
      organizationId: access.organizationId,
      communityId: input.communityId,
      channelId: community.channelId,
      source: input.source,
      amountNanoton: input.amountNanoton,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'OBSERVED',
      externalReference: input.externalReference,
      metadata: (input.metadata ?? null) as never,
    },
  });
  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'revenue.recorded',
    entityType: 'RevenueEntry',
    entityId: entry.id,
    after: { amountNanoton: entry.amountNanoton.toString(), status: entry.status },
  });
  return entry;
}

export async function setRevenueStatus(
  ctx: AppContext,
  actor: Actor,
  entryId: string,
  status: 'CONFIRMED' | 'FUNDED' | 'CANCELLED',
): Promise<RevenueEntry> {
  const entry = await ctx.prisma.revenueEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw notFound('revenue entry not found');
  await requireCommunityAccess(ctx, actor, entry.communityId, 'revenue:manage');
  if (entry.status === 'DISTRIBUTED') throw unprocessable('this revenue has already been distributed');

  const updated = await ctx.prisma.revenueEntry.update({
    where: { id: entryId },
    data: {
      status,
      confirmedAt: status === 'CONFIRMED' || status === 'FUNDED' ? entry.confirmedAt ?? ctx.now() : entry.confirmedAt,
      fundedAt: status === 'FUNDED' ? entry.fundedAt ?? ctx.now() : entry.fundedAt,
    },
  });
  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'revenue.status_changed',
    entityType: 'RevenueEntry',
    entityId: entryId,
    before: { status: entry.status },
    after: { status },
  });
  return updated;
}

export interface OpenCycleInput {
  communityId: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface RevenueCycleResult {
  cycle: RevenueCycle;
  entryCount: number;
}

/**
 * Closes one revenue period: gathers every FUNDED entry inside it, applies the
 * platform fee and the creator share that were in force at the end of the
 * period, and posts the split to the ledger in a single transaction.
 */
export async function openRevenueCycle(ctx: AppContext, actor: Actor, input: OpenCycleInput): Promise<RevenueCycleResult> {
  const access = await requireCommunityAccess(ctx, actor, input.communityId, 'revenue:manage');
  if (input.periodEnd <= input.periodStart) throw badRequest('the cycle period ends before it starts');

  const duplicate = await ctx.prisma.revenueCycle.findUnique({
    where: {
      communityId_periodStart_periodEnd: {
        communityId: input.communityId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    },
  });
  if (duplicate) throw conflict('a revenue cycle already exists for this period');

  const entries = await ctx.prisma.revenueEntry.findMany({
    where: {
      communityId: input.communityId,
      status: 'FUNDED',
      revenueCycleId: null,
      periodStart: { gte: input.periodStart },
      periodEnd: { lte: input.periodEnd },
    },
    select: { id: true, amountNanoton: true },
  });
  if (entries.length === 0) throw unprocessable('there is no funded revenue in this period');

  const gross = entries.reduce((total, entry) => total + entry.amountNanoton, 0n);
  const platform = await currentPlatformPolicy(ctx);
  const revenuePolicy = await effectiveRevenuePolicy(ctx, input.communityId, input.periodEnd);
  const split = splitRevenue(gross, revenuePolicy.creatorShareBps, {
    platformFeeBps: platform.platformFeeBps,
    maxCreatorShareBps: platform.maxCreatorShareBps,
  });

  const cycle = await ctx.prisma.$transaction(async (tx) => {
    const created = await tx.revenueCycle.create({
      data: {
        communityId: input.communityId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        grossNanoton: split.gross,
        platformFeeNanoton: split.platformFee,
        creatorShareNanoton: split.creator,
        communityShareNanoton: split.community,
        platformFeeBps: platform.platformFeeBps,
        creatorShareBps: revenuePolicy.creatorShareBps,
        policySnapshot: {
          platformPolicyVersion: platform.version,
          revenuePolicyVersion: revenuePolicy.version,
          platformFeeBps: platform.platformFeeBps,
          creatorShareBps: revenuePolicy.creatorShareBps,
        } as never,
        status: 'SPLIT',
        fundedAt: ctx.now(),
        splitAt: ctx.now(),
      },
    });

    await tx.revenueEntry.updateMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
      data: { revenueCycleId: created.id, status: 'DISTRIBUTED' },
    });

    await postTransaction(
      tx,
      revenueSplitTransaction({
        revenueCycleId: created.id,
        communityId: input.communityId,
        organizationId: access.organizationId,
        platformFeeNanoton: split.platformFee,
        creatorShareNanoton: split.creator,
        communityShareNanoton: split.community,
      }),
    );
    return created;
  });

  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'revenue.cycle_opened',
    entityType: 'RevenueCycle',
    entityId: cycle.id,
    after: {
      grossNanoton: split.gross.toString(),
      platformFeeNanoton: split.platformFee.toString(),
      creatorShareNanoton: split.creator.toString(),
      communityShareNanoton: split.community.toString(),
    },
  });
  return { cycle, entryCount: entries.length };
}

export async function listRevenueCycles(ctx: AppContext, actor: Actor, communityId: string) {
  await requireCommunityAccess(ctx, actor, communityId, 'analytics:read');
  return ctx.prisma.revenueCycle.findMany({
    where: { communityId },
    include: { rewardCycle: { select: { id: true, status: true, allocatedNanoton: true } } },
    orderBy: { periodStart: 'desc' },
    take: 50,
  });
}
