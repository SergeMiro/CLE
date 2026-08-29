import { describe, expect, it } from 'vitest';
import { formatDate, formatTon, plural, tonToNanoton } from '../lib/format';

describe('formatTon', () => {
  it('renders a nanoton string without floating point', () => {
    expect(formatTon('85500000000')).toBe('85.5');
    expect(formatTon('1000000000')).toBe('1');
    expect(formatTon('1')).toBe('0');
    expect(formatTon('1', 9)).toBe('0.000000001');
  });

  it('keeps precision on a value larger than Number.MAX_SAFE_INTEGER', () => {
    expect(formatTon('9007199254740993000000000', 0)).toBe('9007199254740993');
  });

  it('handles a negative balance and an empty value', () => {
    expect(formatTon('-2500000000')).toBe('-2.5');
    expect(formatTon(undefined)).toBe('0');
    expect(formatTon(null)).toBe('0');
    expect(formatTon('')).toBe('0');
  });

  it('trims trailing zeros but keeps significant digits', () => {
    expect(formatTon('29925000000')).toBe('29.925');
    expect(formatTon('72675000000')).toBe('72.675');
  });
});

describe('tonToNanoton', () => {
  it('parses decimal input to an exact nanoton string', () => {
    expect(tonToNanoton('1')).toBe('1000000000');
    expect(tonToNanoton('0.5')).toBe('500000000');
    expect(tonToNanoton('85.5')).toBe('85500000000');
    expect(tonToNanoton('0,25')).toBe('250000000');
  });

  it('rejects input a wallet could not honour', () => {
    for (const value of ['', 'abc', '-1', '1.0000000001', '1.2.3']) {
      expect(() => tonToNanoton(value)).toThrow();
    }
  });

  it('round-trips through formatTon', () => {
    expect(formatTon(tonToNanoton('12.3456'))).toBe('12.3456');
  });
});

describe('misc formatting', () => {
  it('formats a date and an absent date', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('2026-09-01T00:00:00.000Z')).toMatch(/2026/);
  });

  it('pluralises', () => {
    expect(plural(1, 'quiz', 'quizzes')).toBe('1 quiz');
    expect(plural(2, 'quiz', 'quizzes')).toBe('2 quizzes');
  });
});
