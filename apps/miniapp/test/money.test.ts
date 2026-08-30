import { describe, expect, it } from 'vitest';
import { CLEP_PER_TON, NANOTON_PER_CLEP, amountToNanoton, clepToNanoton, formatClep, formatMoney, formatTon, tonToNanoton } from '../lib/money';

describe('CLE points', () => {
  it('are a thousandth of a TON, exactly', () => {
    expect(CLEP_PER_TON).toBe(1_000n);
    expect(NANOTON_PER_CLEP * CLEP_PER_TON).toBe(1_000_000_000n);
  });

  it('write a balance as whole points where TON writes a fraction', () => {
    expect(formatTon('12480000000')).toBe('12.48');
    expect(formatClep('12480000000')).toBe('12,480');
  });

  it('keep a reward smaller than a point instead of rounding it away', () => {
    // 0.0005 TON — half a point, and real money.
    expect(formatClep('500000')).toBe('0.5');
    expect(formatClep('1000')).toBe('0');
  });

  it('group thousands so a balance can be read at a glance', () => {
    expect(formatClep('4500000000000')).toBe('4,500,000');
  });

  it('write the same amount in whichever unit is being read', () => {
    expect(formatMoney('4500000000', 'CLEP')).toBe('4,500');
    expect(formatMoney('4500000000', 'TON')).toBe('4.5');
  });

  it('turn a typed amount back into nanoton without going through a float', () => {
    expect(clepToNanoton('250')).toBe('250000000');
    expect(clepToNanoton('1,250')).toBe('1250000000');
    expect(clepToNanoton('0.5')).toBe('500000');
    expect(tonToNanoton('0.25')).toBe('250000000');
    expect(amountToNanoton('100', 'CLEP')).toBe(tonToNanoton('0.1'));
  });

  it('round-trips every unit, so what is shown is what is withdrawn', () => {
    for (const nanoton of ['100000000', '4500000000', '12480000000', '1000000']) {
      expect(clepToNanoton(formatClep(nanoton))).toBe(nanoton);
    }
  });

  it('refuses an amount that is not a number', () => {
    expect(() => clepToNanoton('lots')).toThrow();
    expect(() => tonToNanoton('')).toThrow();
  });
});
