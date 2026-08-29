const NANOTON_PER_TON = 1_000_000_000n;

/** Money arrives from the API as a nanoton string and is never parsed into a float. */
export function formatTon(nanoton: string | bigint | undefined | null, fractionDigits = 4): string {
  if (nanoton === undefined || nanoton === null) return '0';
  const value = typeof nanoton === 'bigint' ? nanoton : BigInt(nanoton || '0');
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / NANOTON_PER_TON;
  const fraction = (absolute % NANOTON_PER_TON).toString().padStart(9, '0').slice(0, fractionDigits);
  const trimmed = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${trimmed ? `.${trimmed}` : ''}`;
}

export function tonToNanoton(input: string): string {
  const match = /^(\d+)(?:[.,](\d{1,9}))?$/.exec(input.trim());
  if (!match) throw new Error('Enter an amount like 1.5');
  return (BigInt(match[1] ?? '0') * NANOTON_PER_TON + BigInt((match[2] ?? '').padEnd(9, '0'))).toString();
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
