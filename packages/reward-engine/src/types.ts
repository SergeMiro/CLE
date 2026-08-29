import type { LoyaltyTier, PoolShares } from '@cle/core';

export type RewardPoolType = 'GROWTH' | 'LOYALTY' | 'REFERRAL' | 'LEARNING';

export type MembershipStatus = 'UNKNOWN' | 'ACTIVE' | 'LEFT' | 'BANNED' | 'REJOIN_COOLDOWN';
export type RewardEligibilityStatus = 'PENDING' | 'ELIGIBLE' | 'SUSPENDED' | 'BLOCKED';

/** Everything the engine is allowed to know about a member. It never reads the database itself. */
export interface MemberInput {
  userId: string;
  memberId: string;
  status: MembershipStatus;
  eligibility: RewardEligibilityStatus;
  /** Days since the member's current join, floored. */
  membershipAgeDays: number;
  rejoinCount: number;
  /** Referrals into this community that qualified during or before the cycle. */
  referralUnits: number;
  /** Learning points earned inside the cycle window. */
  learningPoints: number;
}

export interface RewardPolicyInput extends PoolShares {
  newMemberHoldDays: number;
  rejoinCooldownDays: number;
  loyaltyTiers: readonly LoyaltyTier[];
  minRewardNanoton: bigint;
}

export interface MemberEligibility {
  userId: string;
  memberId: string;
  membershipStatus: MembershipStatus;
  membershipAgeDays: number;
  rejoinCount: number;
  growthEligible: boolean;
  loyaltyEligible: boolean;
  loyaltyWeightBps: number;
  referralUnits: number;
  learningPoints: number;
}

export interface PoolResult {
  type: RewardPoolType;
  shareBps: number;
  amountNanoton: bigint;
  distributedNanoton: bigint;
  /** Value that stayed in the community treasury because nobody qualified for it. */
  carriedNanoton: bigint;
}

export interface AllocationResult {
  userId: string;
  memberId: string;
  type: RewardPoolType;
  amountNanoton: bigint;
  weight: bigint;
  sourceUnits: bigint;
}

export interface RewardCycleResult {
  distributableNanoton: bigint;
  pools: PoolResult[];
  allocations: AllocationResult[];
  totalAllocatedNanoton: bigint;
  totalCarriedNanoton: bigint;
  eligibility: MemberEligibility[];
}
