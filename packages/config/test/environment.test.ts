import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../src/index.js';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cle', REDIS_URL: 'redis://localhost:6379',
  MINI_APP_URL: 'http://localhost:3000', API_URL: 'http://localhost:3001', SESSION_SECRET: 'x'.repeat(32),
  MIN_WITHDRAWAL_NANOTON: '100000000',
};

describe('environment', () => {
  it('accepts safe mock configuration', () => expect(parseEnvironment(base).APP_MODE).toBe('mock'));
  it('rejects invalid pool percentages', () => expect(() => parseEnvironment({ ...base, GROWTH_POOL_PERCENT: '34' })).toThrow(/must equal 100/));
  it('requires live credentials only in live mode', () => expect(() => parseEnvironment({ ...base, APP_MODE: 'live' })).toThrow(/live mode requires/));
});

