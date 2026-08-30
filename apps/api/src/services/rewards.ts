import type { RewardCycle } from '@cle/db';
import { rewardCancelTransaction, rewardPendingTransaction, rewardUnlockTransaction } from '@cle/ledger';
import { type MemberInput, allocationIdempotencyKey, calculateRewardCycle } from '@cle/reward-engine';
import type { AppContext } from '../context.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import { recordAudit } from './audit.js';
import { postTransaction } from './ledger.js';
import { membershipAgeDays } from './membership.js';
import { effectiveRewardPolicy, loyaltyTiersOf } from './policies.js';
import { qualifiedReferralCounts, qualifyReferrals } from './referrals.js';
import { type Actor, requireCommunityAccess } from './rbac.js';

/** XP a member earned inside the cycle window (learningPoints in the schema), from submitted attempts only. */
async function learningPointsInPeriod(ctx: AppContext, communityId: string, from: Date, to: Date): Promise<Map<string, number>> {
  const grouped = await ctx.prisma.quizAttempt.groupBy({
    by: ['userId'],
    where: { communityId, status: 'SUBMITTED', submittedAt: { gte: from, lte: to } },
    _sum: { finalPoints: true },
  });
  return new Map(grouped.map((row) => [row.userId, row._sum.finalPoints ?? 0]));
}

export async function createRewardCycle(ctx: AppContext, actor: Actor, revenueCycleId: string): Promise<RewardCycle> {
  const revenueCycle = await ctx.prisma.revenueCycle.findUnique({ where: { id: revenueCycleId }, include: { rewardCycle: true } });
  if (!revenueCycle) throw notFound('revenue cycle not found');
  await requireCommunityAccess(ctx, actor, revenueCycle.communityId, 'reward:approve');
  if (revenueCycle.rewardCycle) return revenueCycle.rewardCycle;
  if (revenueCycle.status !== 'SPLIT' && revenueCycle.status !== 'CLOSED') {
    throw unprocessable('the revenue cycle must be split before rewards can be calculated');
  }

  const policy = await effectiveRewardPolicy(ctx, revenueCycle.communityId, revenueCycle.periodEnd);
  return ctx.prisma.rewardCycle.create({
    data: {
      communityId: revenueCycle.communityId,
      revenueCycleId: revenueCycle.id,
      periodStart: revenueCycle.periodStart,
      periodEnd: revenueCycle.periodEnd,
      distributableNanoton: revenueCycle.communityShareNanoton,
      status: 'DRAFT',
      policySnapshot: {
        rewardPolicyVersion: policy.version,
        growthBps: policy.growthBps,
        loyaltyBps: policy.loyaltyBps,
        referralBps: policy.referralBps,
        learningBps: policy.learningBps,
        newMemberHoldDays: policy.newMemberHoldDays,
        rejoinCooldownDays: policy.rejoinCooldownDays,
        minRewardNanoton: policy.minRewardNanoton.toString(),
        loyaltyTiers: loyaltyTiersOf(policy),
      } as never,
    },
  });
}

/**
 * Freezes an eligibility snapshot and computes every allocation. Recalculating a
 * cycle that has not been finalized replaces the draft allocations; once the
 * cycle is FINALIZED its history is immutable.
 */
export async function calculateCycle(ctx: AppContext, actor: Actor, cycleId: string): Promise<RewardCycle> {
  const cycle = await ctx.prisma.rewardCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw notFound('reward cycle not found');
  await requireCommunityAccess(ctx, actor, cycle.communityId, 'reward:approve');
  if (cycle.status === 'FINALIZED') throw conflict('a finalized cycle cannot be recalculated');

  const policy = await effectiveRewardPolicy(ctx, cycle.communityId, cycle.periodEnd);
  await qualifyReferrals(ctx, cycle.communityId, policy.referralQualificationDays);

  const members = await ctx.prisma.communityMember.findMany({ where: { communityId: cycle.communityId } });
  const referrals = await qualifiedReferralCounts(ctx, cycle.communityId);
  const learning = await learningPointsInPeriod(ctx, cycle.communityId, cycle.periodStart, cycle.periodEnd);

  const input: MemberInput[] = members.map((member) => ({
    userId: member.userId,
    memberId: member.id,
    status: member.status,
    eligibility: member.eligibility,
    membershipAgeDays: membershipAgeDays(member, cycle.periodEnd),
    rejoinCount: member.rejoinCount,
    referralUnits: referrals.get(member.userId) ?? 0,
    learningPoints: learning.get(member.userId) ?? 0,
  }));

  const result = calculateRewardCycle({
    distributableNanoton: cycle.distributableNanoton,
    policy: {
      growthBps: policy.growthBps,
      loyaltyBps: policy.loyaltyBps,
      referralBps: policy.referralBps,
      learningBps: policy.learningBps,
      newMemberHoldDays: policy.newMemberHoldDays,
      rejoinCooldownDays: policy.rejoinCooldownDays,
      loyaltyTiers: loyaltyTiersOf(policy),
      minRewardNanoton: policy.minRewardNanoton,
    },
    members: input,
  });

  const updated = await ctx.prisma.$transaction(async (tx) => {
    await tx.rewardAllocation.deleteMany({ where: { cycleId, status: 'PENDING' } });
    await tx.rewardEligibilitySnapshot.deleteMany({ where: { cycleId } });
    await tx.rewardPool.deleteMany({ where: { cycleId } });

    await tx.rewardEligibilitySnapshot.createMany({
      data: result.eligibility.map((entry) => ({
        cycleId,
        userId: entry.userId,
        memberId: entry.memberId,
        membershipStatus: entry.membershipStatus,
        membershipAgeDays: entry.membershipAgeDays,
        rejoinCount: entry.rejoinCount,
        growthEligible: entry.growthEligible,
        loyaltyEligible: entry.loyaltyEligible,
        loyaltyWeightBps: entry.loyaltyWeightBps,
        referralUnits: entry.referralUnits,
        learningPoints: entry.learningPoints,
      })),
    });
    await tx.rewardPool.createMany({
      data: result.pools.map((pool) => ({
        cycleId,
        type: pool.type,
        shareBps: pool.shareBps,
        amountNanoton: pool.amountNanoton,
        distributedNanoton: pool.distributedNanoton,
        carriedNanoton: pool.carriedNanoton,
      })),
    });
    await tx.rewardAllocation.createMany({
      data: result.allocations.map((allocation) => ({
        cycleId,
        communityId: cycle.communityId,
        userId: allocation.userId,
        type: allocation.type,
        amountNanoton: allocation.amountNanoton,
        weight: allocation.weight,
        sourceUnits: allocation.sourceUnits,
        status: 'PENDING' as const,
        idempotencyKey: allocationIdempotencyKey(cycleId, allocation.userId, allocation.type),
      })),
    });
    return tx.rewardCycle.update({
      where: { id: cycleId },
      data: { status: 'CALCULATED', allocatedNanoton: result.totalAllocatedNanoton, calculatedAt: ctx.now() },
    });
  });

  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'reward.cycle_calculated',
    entityType: 'RewardCycle',
    entityId: cycleId,
    after: {
      allocatedNanoton: result.totalAllocatedNanoton.toString(),
      carriedNanoton: result.totalCarriedNanoton.toString(),
      allocations: result.allocations.length,
    },
  });
  return updated;
}

export async function approveCycle(ctx: AppContext, actor: Actor, cycleId: string): Promise<RewardCycle> {
  const cycle = await ctx.prisma.rewardCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw notFound('reward cycle not found');
  await requireCommunityAccess(ctx, actor, cycle.communityId, 'reward:approve');
  if (cycle.status !== 'CALCULATED') throw unprocessable('only a calculated cycle can be approved');
  const approved = await ctx.prisma.rewardCycle.update({ where: { id: cycleId }, data: { status: 'APPROVED', approvedAt: ctx.now() } });
  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'reward.cycle_approved',
    entityType: 'RewardCycle',
    entityId: cycleId,
  });
  return approved;
}

/**
 * Moves money. Each allocation posts community treasury -> member pending
 * balance, once, keyed by the allocation id. After this the cycle is history.
 */
export async function finalizeCycle(ctx: AppContext, actor: Actor, cycleId: string): Promise<RewardCycle> {
  const cycle = await ctx.prisma.rewardCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw notFound('reward cycle not found');
  await requireCommunityAccess(ctx, actor, cycle.communityId, 'reward:approve');
  if (cycle.status !== 'APPROVED') throw unprocessable('only an approved cycle can be finalized');

  const allocations = await ctx.prisma.rewardAllocation.findMany({ where: { cycleId, status: 'PENDING' } });
  const finalized = await ctx.prisma.$transaction(async (tx) => {
    for (const allocation of allocations) {
      await postTransaction(
        tx,
        rewardPendingTransaction({
          allocationId: allocation.id,
          communityId: cycle.communityId,
          userId: allocation.userId,
          amountNanoton: allocation.amountNanoton,
        }),
      );
      await tx.rewardAllocation.update({ where: { id: allocation.id }, data: { availableAt: ctx.now() } });
    }
    await tx.revenueCycle.update({ where: { id: cycle.revenueCycleId }, data: { status: 'CLOSED', closedAt: ctx.now() } });
    await tx.referral.updateMany({
      where: { communityId: cycle.communityId, status: 'QUALIFIED' },
      data: { status: 'REWARDED', rewardedAt: ctx.now() },
    });
    return tx.rewardCycle.update({ where: { id: cycleId }, data: { status: 'FINALIZED', finalizedAt: ctx.now() } });
  });

  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'reward.cycle_finalized',
    entityType: 'RewardCycle',
    entityId: cycleId,
    after: { allocations: allocations.length },
  });
  return finalized;
}

/** Pending rewards become spendable once their hold has elapsed. */
export async function unlockDueAllocations(ctx: AppContext, communityId?: string): Promise<number> {
  const due = await ctx.prisma.rewardAllocation.findMany({
    where: {
      status: 'PENDING',
      availableAt: { lte: ctx.now() },
      cycle: { status: 'FINALIZED' },
      ...(communityId ? { communityId } : {}),
    },
    take: 500,
  });
  let unlocked = 0;
  for (const allocation of due) {
    await ctx.prisma.$transaction(async (tx) => {
      await postTransaction(
        tx,
        rewardUnlockTransaction({
          allocationId: allocation.id,
          communityId: allocation.communityId,
          userId: allocation.userId,
          amountNanoton: allocation.amountNanoton,
        }),
      );
      await tx.rewardAllocation.update({ where: { id: allocation.id }, data: { status: 'AVAILABLE' } });
    });
    unlocked += 1;
  }
  return unlocked;
}

/** Returns a pending allocation to the community, e.g. when fraud is confirmed. */
export async function cancelAllocation(ctx: AppContext, actor: Actor, allocationId: string, reason: string): Promise<void> {
  const allocation = await ctx.prisma.rewardAllocation.findUnique({ where: { id: allocationId } });
  if (!allocation) throw notFound('allocation not found');
  await requireCommunityAccess(ctx, actor, allocation.communityId, 'reward:approve');
  if (allocation.status !== 'PENDING') throw unprocessable('only a pending allocation can be cancelled');

  await ctx.prisma.$transaction(async (tx) => {
    await postTransaction(
      tx,
      rewardCancelTransaction({
        allocationId: allocation.id,
        communityId: allocation.communityId,
        userId: allocation.userId,
        amountNanoton: allocation.amountNanoton,
      }),
    );
    await tx.rewardAllocation.update({ where: { id: allocationId }, data: { status: 'CANCELLED', cancelledAt: ctx.now() } });
  });
  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'reward.allocation_cancelled',
    entityType: 'RewardAllocation',
    entityId: allocationId,
    after: { reason },
  });
}
