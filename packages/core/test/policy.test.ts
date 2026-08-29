import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOYALTY_TIERS,
  MoneyError,
  NANOTON_PER_TON,
  assertCreatorShareAllowed,
  daysBetween,
  loyaltyTierFor,
  loyaltyWeightBps,
  parseTon,
  splitPools,
  splitRevenue,
} from '../src/index.js';

const constraints = { platformFeeBps: 1000, maxCreatorShareBps: 1000 };

describe('splitRevenue', () => {
  it('reproduces the specification example at a 5% creator share', () => {
    const split = splitRevenue(100n * NANOTON_PER_TON, 500, constraints);
    expect(split.platformFee).toBe(parseTon('10'));
    expect(split.net).toBe(parseTon('90'));
    expect(split.creator).toBe(parseTon('4.5'));
    expect(split.community).toBe(parseTon('85.5'));
  });

  it('reproduces the specification example at the 10% creator maximum', () => {
    const split = splitRevenue(100n * NANOTON_PER_TON, 1000, constraints);
    expect(split.creator).toBe(parseTon('9'));
    expect(split.community).toBe(parseTon('81'));
  });

  it('gives the community everything after the fee when the creator takes nothing', () => {
    const split = splitRevenue(parseTon('100'), 0, constraints);
    expect(split.creator).toBe(0n);
    expect(split.community).toBe(parseTon('90'));
  });

  it('conserves every nanoton', () => {
    for (const gross of [0n, 1n, 7n, 999n, 123_456_789n, parseTon('12.345678901')]) {
      for (const creatorBps of [0, 1, 250, 500, 999, 1000]) {
        const split = splitRevenue(gross, creatorBps, constraints);
        expect(split.platformFee + split.creator + split.community).toBe(gross);
      }
    }
  });

  it('refuses a creator share above the platform ceiling', () => {
    expect(() => splitRevenue(parseTon('100'), 1001, constraints)).toThrow(/exceeds the platform maximum/);
    expect(() => assertCreatorShareAllowed(2000, constraints)).toThrow(MoneyError);
  });

  it('rejects negative revenue', () => {
    expect(() => splitRevenue(-1n, 0, constraints)).toThrow(MoneyError);
  });
});

describe('splitPools', () => {
  const shares = { growthBps: 3500, loyaltyBps: 4000, referralBps: 1500, learningBps: 1000 };

  it('splits the community share by policy', () => {
    const pools = splitPools(parseTon('85.5'), shares);
    expect(pools.growth).toBe(parseTon('29.925'));
    expect(pools.loyalty).toBe(parseTon('34.2'));
    expect(pools.referral).toBe(parseTon('12.825'));
    expect(pools.learning).toBe(parseTon('8.55'));
  });

  it('conserves the community share exactly, including indivisible remainders', () => {
    for (const amount of [0n, 1n, 3n, 7n, 999n, 1_000_000_007n]) {
      const pools = splitPools(amount, shares);
      expect(pools.growth + pools.loyalty + pools.referral + pools.learning).toBe(amount);
    }
  });

  it('rejects shares that do not total 100%', () => {
    expect(() => splitPools(100n, { ...shares, growthBps: 3000 })).toThrow(/must total 10000 bps/);
  });
});

describe('loyalty tiers', () => {
  it('maps membership age to the highest reached tier', () => {
    expect(loyaltyTierFor(0)?.key).toBe('curious');
    expect(loyaltyTierFor(29)?.key).toBe('curious');
    expect(loyaltyTierFor(30)?.key).toBe('explorer');
    expect(loyaltyTierFor(400)?.key).toBe('expert');
  });

  it('exposes the tier weight in basis points', () => {
    expect(loyaltyWeightBps(0)).toBe(10_000);
    expect(loyaltyWeightBps(365)).toBe(20_000);
  });

  it('returns zero weight when no tier matches', () => {
    expect(loyaltyWeightBps(5, [{ key: 'late', minDays: 10, weightBps: 10_000 }])).toBe(0);
  });

  it('ships tiers in ascending order', () => {
    const days = DEFAULT_LOYALTY_TIERS.map((tier) => tier.minDays);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it('rejects a fractional age', () => {
    expect(() => loyaltyWeightBps(1.5)).toThrow(MoneyError);
  });
});

describe('daysBetween', () => {
  it('floors partial days and never goes negative', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(daysBetween(from, new Date('2026-01-08T23:59:00Z'))).toBe(7);
    expect(daysBetween(from, new Date('2025-12-01T00:00:00Z'))).toBe(0);
  });
});
