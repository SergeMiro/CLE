import { BPS_TOTAL, MoneyError, applyBps, allocateByWeight, assertBps, assertNonNegative } from './money.js';

export interface PlatformConstraints {
  /** CLE fee, taken off gross revenue before anything else. */
  platformFeeBps: number;
  /** Hard ceiling on the creator's share of the post-fee remainder. */
  maxCreatorShareBps: number;
}

export interface PoolShares {
  growthBps: number;
  loyaltyBps: number;
  referralBps: number;
  learningBps: number;
}

export interface RevenueSplit {
  gross: bigint;
  platformFee: bigint;
  /** Gross minus the platform fee — the base the creator share is taken from. */
  net: bigint;
  creator: bigint;
  community: bigint;
}

export interface PoolSplit {
  growth: bigint;
  loyalty: bigint;
  referral: bigint;
  learning: bigint;
}

export interface LoyaltyTier {
  key: string;
  minDays: number;
  weightBps: number;
}

/** The creator can only choose inside the platform boundary; a request above it is rejected, not clamped. */
export function assertCreatorShareAllowed(creatorShareBps: number, constraints: PlatformConstraints): void {
  assertBps(creatorShareBps, 'creatorShareBps');
  assertBps(constraints.maxCreatorShareBps, 'maxCreatorShareBps');
  if (creatorShareBps > constraints.maxCreatorShareBps) {
    throw new MoneyError(
      `creator share ${creatorShareBps} bps exceeds the platform maximum of ${constraints.maxCreatorShareBps} bps`,
    );
  }
}

export function assertPoolShares(shares: PoolShares): void {
  // Only the four share fields are validated: callers routinely pass a wider policy object.
  const entries: [string, number][] = [
    ['growthBps', shares.growthBps],
    ['loyaltyBps', shares.loyaltyBps],
    ['referralBps', shares.referralBps],
    ['learningBps', shares.learningBps],
  ];
  for (const [key, value] of entries) assertBps(value, key);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total !== BPS_TOTAL) throw new MoneyError(`reward pool shares must total ${BPS_TOTAL} bps, received ${total}`);
}

/**
 * gross -> platform fee -> creator share of the remainder -> community share.
 * Every nanoton is accounted for: platformFee + creator + community === gross.
 */
export function splitRevenue(gross: bigint, creatorShareBps: number, constraints: PlatformConstraints): RevenueSplit {
  assertNonNegative(gross, 'gross');
  assertCreatorShareAllowed(creatorShareBps, constraints);
  const platformFee = applyBps(gross, constraints.platformFeeBps);
  const net = gross - platformFee;
  const creator = applyBps(net, creatorShareBps);
  const community = net - creator;
  return { gross, platformFee, net, creator, community };
}

/** Splits the community share across reward pools so the parts sum to exactly the community share. */
export function splitPools(communityShare: bigint, shares: PoolShares): PoolSplit {
  assertNonNegative(communityShare, 'communityShare');
  assertPoolShares(shares);
  const [growth = 0n, loyalty = 0n, referral = 0n, learning = 0n] = allocateByWeight(communityShare, [
    BigInt(shares.growthBps),
    BigInt(shares.loyaltyBps),
    BigInt(shares.referralBps),
    BigInt(shares.learningBps),
  ]);
  return { growth, loyalty, referral, learning };
}

export const DEFAULT_LOYALTY_TIERS: readonly LoyaltyTier[] = [
  { key: 'curious', minDays: 0, weightBps: 10_000 },
  { key: 'explorer', minDays: 30, weightBps: 12_500 },
  { key: 'researcher', minDays: 90, weightBps: 15_000 },
  { key: 'scientist', minDays: 180, weightBps: 17_500 },
  { key: 'expert', minDays: 365, weightBps: 20_000 },
];

export function loyaltyTierFor(ageDays: number, tiers: readonly LoyaltyTier[] = DEFAULT_LOYALTY_TIERS): LoyaltyTier | undefined {
  if (!Number.isInteger(ageDays) || ageDays < 0) throw new MoneyError('ageDays must be a non-negative integer');
  return [...tiers].sort((a, b) => a.minDays - b.minDays).filter((tier) => ageDays >= tier.minDays).at(-1);
}

export function loyaltyWeightBps(ageDays: number, tiers: readonly LoyaltyTier[] = DEFAULT_LOYALTY_TIERS): number {
  return loyaltyTierFor(ageDays, tiers)?.weightBps ?? 0;
}

/** Whole days elapsed, floored — a member is "7 days old" only after 7 full days. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}
