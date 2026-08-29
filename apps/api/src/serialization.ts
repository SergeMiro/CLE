/**
 * BigInt does not survive JSON.stringify, and money must never be rendered as a
 * float, so every bigint leaves the API as a decimal string.
 */
export function serialize<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}
