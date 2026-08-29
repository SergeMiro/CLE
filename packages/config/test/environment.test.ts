import { describe, expect, it } from 'vitest';
import { ConfigurationError, bootstrapPlatformPolicy, parseEnvironment, platformAdminTelegramIds } from '../src/index.js';

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_MODE: 'mock',
  DATABASE_URL: 'postgresql://cle:cle@localhost:5432/cle?schema=public',
  REDIS_URL: 'redis://localhost:6380',
  API_URL: 'http://localhost:4101',
  MINI_APP_URL: 'http://localhost:4100',
  SESSION_SECRET: 'a'.repeat(32),
  MIN_WITHDRAWAL_NANOTON: '100000000',
};

describe('parseEnvironment', () => {
  it('accepts a minimal mock configuration', () => {
    const env = parseEnvironment(base);
    expect(env.APP_MODE).toBe('mock');
    expect(env.PLATFORM_FEE_BPS).toBe(1000);
    expect(env.MIN_WITHDRAWAL_NANOTON).toBe(100_000_000n);
  });

  it('treats blank values as unset so .env placeholders keep defaults', () => {
    const env = parseEnvironment({ ...base, TELEGRAM_BOT_TOKEN: '', AI_MODEL: '   ' });
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.AI_MODEL).toBeUndefined();
  });

  it('rejects a session secret shorter than 32 characters', () => {
    expect(() => parseEnvironment({ ...base, SESSION_SECRET: 'short' })).toThrow(ConfigurationError);
  });

  it('rejects reward pool defaults that do not total 10000 bps', () => {
    expect(() => parseEnvironment({ ...base, DEFAULT_GROWTH_BPS: '5000' })).toThrow(/must total 10000 bps/);
  });

  it('rejects a platform fee and creator cap that exceed the gross revenue', () => {
    expect(() => parseEnvironment({ ...base, PLATFORM_FEE_BPS: '9000', MAX_CREATOR_SHARE_BPS: '2000' })).toThrow(
      /cannot exceed 10000 bps/,
    );
  });

  it('requires Telegram credentials in live mode', () => {
    expect(() => parseEnvironment({ ...base, APP_MODE: 'live' })).toThrow(/live mode requires/);
  });

  it('accepts live mode once Telegram credentials are present', () => {
    const env = parseEnvironment({
      ...base,
      APP_MODE: 'live',
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_BOT_USERNAME: 'cle_bot',
      TELEGRAM_WEBHOOK_SECRET: 'secret',
    });
    expect(env.APP_MODE).toBe('live');
  });

  it('requires an API key for a non-mock AI provider', () => {
    expect(() => parseEnvironment({ ...base, AI_PROVIDER: 'openrouter' })).toThrow(/requires AI_API_KEY/);
  });

  it('parses platform admin Telegram ids and ignores malformed entries', () => {
    const env = parseEnvironment({ ...base, PLATFORM_ADMIN_TELEGRAM_IDS: '123, 456 ,abc,' });
    expect(platformAdminTelegramIds(env)).toEqual([123n, 456n]);
  });

  it('exposes bootstrap platform policy values', () => {
    const policy = bootstrapPlatformPolicy(parseEnvironment(base));
    expect(policy.platformFeeBps).toBe(1000);
    expect(policy.defaultPools.loyaltyBps).toBe(4000);
    expect(policy.allowedPoolTypes).toContain('LEARNING');
  });
});
