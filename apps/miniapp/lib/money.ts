/*
 * CLE points are a way of writing a TON balance, not a second currency: one
 * CLEP is exactly a thousandth of a TON, so the ledger stays in nanoton and
 * nothing is ever converted — only displayed differently. A whole CLEP is a
 * million nanoton, which keeps every conversion exact in integers.
 */
const NANOTON_PER_TON = 1_000_000_000n;
export const NANOTON_PER_CLEP = 1_000_000n;
export const CLEP_PER_TON = 1_000n;

export type MoneyUnit = 'CLEP' | 'TON';

export const OTHER_UNIT: Record<MoneyUnit, MoneyUnit> = { CLEP: 'TON', TON: 'CLEP' };

function toBigInt(nanoton: string | bigint | undefined | null): bigint {
  if (nanoton === undefined || nanoton === null) return 0n;
  return typeof nanoton === 'bigint' ? nanoton : BigInt(nanoton || '0');
}

/** 1234567 → "1,234,567"; thousands are what make a points balance readable. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function split(value: bigint, per: bigint, scale: number, fractionDigits: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / per;
  const fraction = (absolute % per).toString().padStart(scale, '0').slice(0, fractionDigits).replace(/0+$/, '');
  return `${negative ? '-' : ''}${group(whole.toString())}${fraction ? `.${fraction}` : ''}`;
}

/** Money arrives from the API as a nanoton string and is never parsed into a float. */
export function formatTon(nanoton: string | bigint | undefined | null, fractionDigits = 4): string {
  return split(toBigInt(nanoton), NANOTON_PER_TON, 9, fractionDigits);
}

/**
 * Rewards can be smaller than a whole point, and rounding one away would be
 * money quietly disappearing, so two decimals stay available.
 */
export function formatClep(nanoton: string | bigint | undefined | null, fractionDigits = 2): string {
  return split(toBigInt(nanoton), NANOTON_PER_CLEP, 6, fractionDigits);
}

export function formatMoney(nanoton: string | bigint | undefined | null, unit: MoneyUnit, tonFractionDigits = 4): string {
  return unit === 'CLEP' ? formatClep(nanoton) : formatTon(nanoton, tonFractionDigits);
}

export function tonToNanoton(input: string): string {
  const match = /^(\d+)(?:[.,](\d{1,9}))?$/.exec(input.trim());
  if (!match) throw new Error('Enter an amount like 1.5');
  return (BigInt(match[1] ?? '0') * NANOTON_PER_TON + BigInt((match[2] ?? '').padEnd(9, '0'))).toString();
}

export function clepToNanoton(input: string): string {
  const match = /^(\d[\d,\s]*)(?:[.,](\d{1,6}))?$/.exec(input.trim());
  if (!match) throw new Error('Enter an amount like 250');
  const whole = BigInt((match[1] ?? '0').replace(/[,\s]/g, ''));
  return (whole * NANOTON_PER_CLEP + BigInt((match[2] ?? '').padEnd(6, '0'))).toString();
}

/** Whatever unit the person is typing in, the ledger is told nanoton. */
export function amountToNanoton(input: string, unit: MoneyUnit): string {
  return unit === 'CLEP' ? clepToNanoton(input) : tonToNanoton(input);
}
