import { MoneyError, allocateByWeight, assertNonNegative, loyaltyWeightBps, splitPools } from '@cle/core';
import type {
  AllocationResult,
  MemberEligibility,
  MemberInput,
  PoolResult,
  RewardCycleResult,
  RewardPolicyInput,
  RewardPoolType,
} from './types.js';

export class RewardEngineError extends Error {}

/**
 * Decides what a member qualifies for in a cycle. Pure and side-effect free, so the
 * result can be frozen as an immutable snapshot before any money moves.
 */
export function evaluateMember(member: MemberInput, policy: RewardPolicyInput): MemberEligibility {
  if (!Number.isInteger(member.membershipAgeDays) || member.membershipAgeDays < 0) {
    throw new RewardEngineError(`member ${member.userId} has an invalid membership age`);
  }
  if (member.referralUnits < 0 || member.learningPoints < 0) {
    throw new RewardEngineError(`member ${member.userId} has negative units`);
  }

  const blocked = member.eligibility === 'BLOCKED' || member.eligibility === 'SUSPENDED';
  const active = member.status === 'ACTIVE' && !blocked;
  const heldAsNewMember = member.membershipAgeDays < policy.newMemberHoldDays;
  const inRejoinCooldown = member.status === 'REJOIN_COOLDOWN' || (member.rejoinCount > 0 && member.membershipAgeDays < policy.rejoinCooldownDays);

  const growthEligible = active && !heldAsNewMember && !inRejoinCooldown;
  const loyaltyEligible = growthEligible;

  return {
    userId: member.userId,
    memberId: member.memberId,
    membershipStatus: member.status,
    membershipAgeDays: member.membershipAgeDays,
    rejoinCount: member.rejoinCount,
    growthEligible,
    loyaltyEligible,
    loyaltyWeightBps: loyaltyEligible ? loyaltyWeightBps(member.membershipAgeDays, policy.loyaltyTiers) : 0,
    // Referral and learning rewards are earned by an action, so only an active,
    // unblocked member collects them — but they are not subject to the new-member hold.
    referralUnits: active ? member.referralUnits : 0,
    learningPoints: active ? member.learningPoints : 0,
  };
}

interface PoolPlan {
  type: RewardPoolType;
  shareBps: number;
  amountNanoton: bigint;
  weights: { userId: string; memberId: string; weight: bigint; sourceUnits: bigint }[];
}

function planFor(type: RewardPoolType, shareBps: number, amountNanoton: bigint, eligibility: readonly MemberEligibility[]): PoolPlan {
  const weights = eligibility
    .map((member) => {
      switch (type) {
        case 'GROWTH':
          return { member, weight: member.growthEligible ? 1n : 0n, sourceUnits: member.growthEligible ? 1n : 0n };
        case 'LOYALTY':
          return { member, weight: BigInt(member.loyaltyWeightBps), sourceUnits: BigInt(member.membershipAgeDays) };
        case 'REFERRAL':
          return { member, weight: BigInt(member.referralUnits), sourceUnits: BigInt(member.referralUnits) };
        case 'LEARNING':
          return { member, weight: BigInt(member.learningPoints), sourceUnits: BigInt(member.learningPoints) };
      }
    })
    .filter((entry) => entry.weight > 0n)
    .map((entry) => ({ userId: entry.member.userId, memberId: entry.member.memberId, weight: entry.weight, sourceUnits: entry.sourceUnits }));
  return { type, shareBps, amountNanoton, weights };
}

export interface CalculateRewardCycleInput {
  distributableNanoton: bigint;
  policy: RewardPolicyInput;
  members: readonly MemberInput[];
}

/**
 * Turns one community share into per-member allocations.
 *
 * Guarantees:
 *  - every nanoton is either allocated or carried back to the community treasury;
 *  - the same input always produces the same output, ordered deterministically;
 *  - a pool with no qualifying members is carried, never silently redistributed.
 */
export function calculateRewardCycle(input: CalculateRewardCycleInput): RewardCycleResult {
  assertNonNegative(input.distributableNanoton, 'distributableNanoton');
  assertNonNegative(input.policy.minRewardNanoton, 'minRewardNanoton');

  const seen = new Set<string>();
  for (const member of input.members) {
    if (seen.has(member.userId)) throw new RewardEngineError(`member ${member.userId} appears twice in the cycle input`);
    seen.add(member.userId);
  }

  const eligibility = input.members.map((member) => evaluateMember(member, input.policy)).sort((a, b) => a.userId.localeCompare(b.userId));

  let poolAmounts: { growth: bigint; loyalty: bigint; referral: bigint; learning: bigint };
  try {
    poolAmounts = splitPools(input.distributableNanoton, input.policy);
  } catch (error) {
    throw error instanceof MoneyError ? new RewardEngineError(error.message) : error;
  }

  const plans: PoolPlan[] = [
    planFor('GROWTH', input.policy.growthBps, poolAmounts.growth, eligibility),
    planFor('LOYALTY', input.policy.loyaltyBps, poolAmounts.loyalty, eligibility),
    planFor('REFERRAL', input.policy.referralBps, poolAmounts.referral, eligibility),
    planFor('LEARNING', input.policy.learningBps, poolAmounts.learning, eligibility),
  ];

  const pools: PoolResult[] = [];
  const allocations: AllocationResult[] = [];

  for (const plan of plans) {
    const amounts = allocateByWeight(plan.amountNanoton, plan.weights.map((entry) => entry.weight));
    let distributed = 0n;
    for (const [index, entry] of plan.weights.entries()) {
      const amount = amounts[index] ?? 0n;
      // A dust allocation costs more to track than it is worth; it stays with the community.
      if (amount < input.policy.minRewardNanoton || amount === 0n) continue;
      allocations.push({
        userId: entry.userId,
        memberId: entry.memberId,
        type: plan.type,
        amountNanoton: amount,
        weight: entry.weight,
        sourceUnits: entry.sourceUnits,
      });
      distributed += amount;
    }
    pools.push({
      type: plan.type,
      shareBps: plan.shareBps,
      amountNanoton: plan.amountNanoton,
      distributedNanoton: distributed,
      carriedNanoton: plan.amountNanoton - distributed,
    });
  }

  const totalAllocatedNanoton = allocations.reduce((total, allocation) => total + allocation.amountNanoton, 0n);
  const totalCarriedNanoton = pools.reduce((total, pool) => total + pool.carriedNanoton, 0n);

  if (totalAllocatedNanoton + totalCarriedNanoton !== input.distributableNanoton) {
    throw new RewardEngineError('reward calculation lost value: allocated + carried does not equal the distributable amount');
  }

  return {
    distributableNanoton: input.distributableNanoton,
    pools,
    allocations,
    totalAllocatedNanoton,
    totalCarriedNanoton,
    eligibility,
  };
}

/** Stable, replay-safe key so re-running a cycle can never double-pay a member. */
export function allocationIdempotencyKey(cycleId: string, userId: string, type: RewardPoolType): string {
  return `${cycleId}:${userId}:${type}`;
}
