import { describe, expect, it } from 'vitest';
import { MoneyError, NANOTON_PER_TON, allocateByWeight, applyBps, formatTon, parseTon } from '../src/index.js';

describe('applyBps', () => {
  it('floors instead of rounding', () => {
    expect(applyBps(999n, 1000)).toBe(99n);
    expect(applyBps(1n, 5000)).toBe(0n);
  });

  it('rejects an out-of-range share', () => {
    expect(() => applyBps(100n, 10_001)).toThrow(MoneyError);
    expect(() => applyBps(100n, -1)).toThrow(MoneyError);
  });
});

describe('allocateByWeight', () => {
  it('distributes the pool exactly, with no nanoton lost or invented', () => {
    const parts = allocateByWeight(100n, [1n, 1n, 1n]);
    expect(parts.reduce((total, part) => total + part, 0n)).toBe(100n);
    expect(parts).toEqual([34n, 33n, 33n]);
  });

  it('is deterministic for identical weights', () => {
    expect(allocateByWeight(10n, [1n, 1n, 1n, 1n])).toEqual(allocateByWeight(10n, [1n, 1n, 1n, 1n]));
  });

  it('returns zeros when every weight is zero', () => {
    expect(allocateByWeight(500n, [0n, 0n])).toEqual([0n, 0n]);
  });

  it('handles a pool smaller than the number of participants', () => {
    const parts = allocateByWeight(2n, [5n, 3n, 1n]);
    expect(parts.reduce((total, part) => total + part, 0n)).toBe(2n);
    expect(parts).toEqual([1n, 1n, 0n]);
  });

  it('keeps the sum exact across randomised weights', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const weights = Array.from({ length: (seed % 9) + 1 }, (_, index) => BigInt(((seed * 7 + index * 13) % 97) + 1));
      const pool = BigInt(seed * 1_237 + 1);
      expect(allocateByWeight(pool, weights).reduce((total, part) => total + part, 0n)).toBe(pool);
    }
  });

  it('rejects negative input', () => {
    expect(() => allocateByWeight(-1n, [1n])).toThrow(MoneyError);
    expect(() => allocateByWeight(1n, [-1n])).toThrow(MoneyError);
  });
});

describe('formatTon / parseTon', () => {
  it('round-trips a nanoton amount', () => {
    expect(parseTon(formatTon(1_500_000_000n, 9))).toBe(1_500_000_000n);
  });

  it('formats with the requested precision', () => {
    expect(formatTon(NANOTON_PER_TON + 123_456_789n)).toBe('1.1234');
    expect(formatTon(85_500_000_000n, 2)).toBe('85.50');
  });

  it('parses a nanoton-precision value without float error', () => {
    expect(parseTon('0.000000001')).toBe(1n);
    expect(parseTon('100')).toBe(100_000_000_000n);
  });

  it('rejects malformed amounts', () => {
    expect(() => parseTon('1.0000000001')).toThrow(MoneyError);
    expect(() => parseTon('abc')).toThrow(MoneyError);
  });
});
