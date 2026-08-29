import { describe, expect, it } from 'vitest';
import { NANOTON_PER_TON, allocateByWeight, splitRevenue } from '../src/index.js';

describe('reward engine', () => {
  it('splits 100 TON exactly with no float arithmetic', () => {
    const split = splitRevenue(100n * NANOTON_PER_TON, { creator: 10n, growth: 35n, loyalty: 40n, referral: 15n, science: 10n });
    expect(split.creator).toBe(10n * NANOTON_PER_TON);
    expect(split.community).toBe(90n * NANOTON_PER_TON);
    expect(split.growth).toBe(31_500_000_000n);
    expect(split.loyalty).toBe(36n * NANOTON_PER_TON);
    expect(split.referral).toBe(13_500_000_000n);
    expect(split.science).toBe(9n * NANOTON_PER_TON);
  });

  it('preserves every nanoton during weighted rounding', () => {
    const allocations = allocateByWeight(10n, [1n, 1n, 1n]);
    expect(allocations.reduce((total, value) => total + value, 0n)).toBe(10n);
    expect(allocations).toEqual([4n, 3n, 3n]);
  });
});
