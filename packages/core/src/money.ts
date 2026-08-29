/** All CLE money is an integer number of nanotons; floating point never touches a balance. */
export const NANOTON_PER_TON = 1_000_000_000n;
export const BPS_TOTAL = 10_000;
export const BPS_TOTAL_BIG = 10_000n;

export class MoneyError extends Error {}

export function assertNonNegative(value: bigint, label: string): bigint {
  if (value < 0n) throw new MoneyError(`${label} must be non-negative`);
  return value;
}

export function assertBps(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > BPS_TOTAL) {
    throw new MoneyError(`${label} must be an integer between 0 and ${BPS_TOTAL} basis points`);
  }
  return value;
}

/** Floor of `amount * bps / 10000` — the platform never rounds money up in its own favour by accident. */
export function applyBps(amount: bigint, bps: number): bigint {
  assertNonNegative(amount, 'amount');
  assertBps(bps, 'bps');
  return (amount * BigInt(bps)) / BPS_TOTAL_BIG;
}

/**
 * Splits `pool` across `weights` so the parts sum to exactly `pool`.
 * Largest-remainder method with a deterministic tie-break on index, so a
 * recalculation of the same cycle always produces byte-identical allocations.
 */
export function allocateByWeight(pool: bigint, weights: readonly bigint[]): bigint[] {
  assertNonNegative(pool, 'pool');
  if (weights.some((weight) => weight < 0n)) throw new MoneyError('weights must be non-negative');
  const totalWeight = weights.reduce((total, weight) => total + weight, 0n);
  if (totalWeight === 0n) return weights.map(() => 0n);

  const base = weights.map((weight) => (pool * weight) / totalWeight);
  let remaining = pool - base.reduce((total, amount) => total + amount, 0n);
  const order = weights
    .map((weight, index) => ({ index, remainder: (pool * weight) % totalWeight }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));

  for (const item of order) {
    if (remaining <= 0n) break;
    base[item.index] = (base[item.index] ?? 0n) + 1n;
    remaining -= 1n;
  }
  return base;
}

/** Human-readable TON with full nanoton precision preserved (no float involved). */
export function formatTon(nanoton: bigint, fractionDigits = 4): string {
  const negative = nanoton < 0n;
  const value = negative ? -nanoton : nanoton;
  const whole = value / NANOTON_PER_TON;
  const fraction = (value % NANOTON_PER_TON).toString().padStart(9, '0').slice(0, fractionDigits);
  const sign = negative ? '-' : '';
  return fractionDigits > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/** Parses a decimal TON string ("1.5", "0.000000001") into nanotons without float rounding. */
export function parseTon(input: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,9}))?$/.exec(input.trim());
  if (!match) throw new MoneyError(`"${input}" is not a valid TON amount`);
  const [, sign, whole, fraction = ''] = match;
  const nanoton = BigInt(whole ?? '0') * NANOTON_PER_TON + BigInt(fraction.padEnd(9, '0'));
  return sign === '-' ? -nanoton : nanoton;
}
