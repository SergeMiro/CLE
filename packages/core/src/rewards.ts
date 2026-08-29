import { allocateByWeight, assertNonNegative } from './money.js';

export interface RewardPercentages {
  creator: bigint;
  growth: bigint;
  loyalty: bigint;
  referral: bigint;
  science: bigint;
}

export interface RevenueSplit {
  gross: bigint;
  creator: bigint;
  community: bigint;
  growth: bigint;
  loyalty: bigint;
  referral: bigint;
  science: bigint;
}

const PERCENT_DENOMINATOR = 100n;

export function validateRewardPercentages(percentages: RewardPercentages): void {
  const values = Object.values(percentages);
  if (values.some((value) => value < 0n)) throw new Error('percentages must be non-negative');
  if (percentages.creator > PERCENT_DENOMINATOR) throw new Error('creator percentage exceeds 100');
  if (percentages.growth + percentages.loyalty + percentages.referral + percentages.science !== PERCENT_DENOMINATOR) {
    throw new Error('community pool percentages must total exactly 100');
  }
}

export function splitRevenue(gross: bigint, percentages: RewardPercentages): RevenueSplit {
  assertNonNegative(gross, 'gross revenue');
  validateRewardPercentages(percentages);
  const creator = (gross * percentages.creator) / PERCENT_DENOMINATOR;
  const community = gross - creator;
  const pools = allocateByWeight(community, [
    percentages.growth,
    percentages.loyalty,
    percentages.referral,
    percentages.science,
  ]);
  return {
    gross,
    creator,
    community,
    growth: pools[0]!,
    loyalty: pools[1]!,
    referral: pools[2]!,
    science: pools[3]!,
  };
}

export function loyaltyWeightBasisPoints(ageDays: number, tiers: readonly { minDays: number; weightBps: number }[]): bigint {
  if (!Number.isInteger(ageDays) || ageDays < 0) throw new Error('ageDays must be a non-negative integer');
  const sorted = [...tiers].sort((a, b) => a.minDays - b.minDays);
  const tier = sorted.filter((candidate) => ageDays >= candidate.minDays).at(-1);
  if (!tier) return 0n;
  return BigInt(tier.weightBps);
}
