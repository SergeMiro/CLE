export const NANOTON_PER_TON = 1_000_000_000n;

export function assertNonNegative(value: bigint, label: string): bigint {
  if (value < 0n) throw new Error(`${label} must be non-negative`);
  return value;
}

/** Allocates a bigint pool exactly, using a deterministic largest-remainder method. */
export function allocateByWeight(pool: bigint, weights: readonly bigint[]): bigint[] {
  assertNonNegative(pool, 'pool');
  if (weights.some((weight) => weight < 0n)) throw new Error('weights must be non-negative');
  const totalWeight = weights.reduce((total, weight) => total + weight, 0n);
  if (totalWeight === 0n) return weights.map(() => 0n);
  const base = weights.map((weight) => (pool * weight) / totalWeight);
  let remaining = pool - base.reduce((total, amount) => total + amount, 0n);
  const order = weights
    .map((weight, index) => ({ index, remainder: (pool * weight) % totalWeight }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const item of order) {
    if (remaining === 0n) break;
    base[item.index] = (base[item.index] ?? 0n) + 1n;
    remaining -= 1n;
  }
  return base;
}

