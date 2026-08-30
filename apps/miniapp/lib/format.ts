/*
 * Money formatting lives in ./money, which knows about both units. It is
 * re-exported here so the screens keep one import for everything they format.
 */
export { formatClep, formatMoney, formatTon, amountToNanoton, clepToNanoton, tonToNanoton } from './money';
export type { MoneyUnit } from './money';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
