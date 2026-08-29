import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentials, expectedTelegramId, isInsideTelegram } from '../lib/telegram';

function stubWindow(search: string, telegram?: unknown): void {
  vi.stubGlobal('window', { location: { search }, Telegram: telegram });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('credentials', () => {
  it('prefers the signed initData Telegram provides', () => {
    stubWindow('', { WebApp: { initData: 'auth_date=1&hash=abc', initDataUnsafe: { start_param: 'q_abc', user: { id: 7 } } } });
    expect(credentials()).toEqual({ initData: 'auth_date=1&hash=abc', startParam: 'q_abc' });
    expect(isInsideTelegram()).toBe(true);
  });

  it('falls back to the development shortcut outside Telegram', () => {
    stubWindow('?mockUser=500001&mockUsername=tester&startapp=c_abc');
    expect(credentials()).toEqual({ initData: 'mock:500001:tester', startParam: 'c_abc' });
    expect(isInsideTelegram()).toBe(false);
  });

  it('returns nothing when there is no credential at all', () => {
    stubWindow('');
    expect(credentials()).toBeUndefined();
  });
});

describe('expectedTelegramId', () => {
  it('reads the account from Telegram', () => {
    stubWindow('', { WebApp: { initData: 'signed', initDataUnsafe: { user: { id: 42 } } } });
    expect(expectedTelegramId()).toBe('42');
  });

  it('reads the account from the development parameter', () => {
    stubWindow('?mockUser=99');
    expect(expectedTelegramId()).toBe('99');
  });

  it('is undefined when no account is identified', () => {
    stubWindow('');
    expect(expectedTelegramId()).toBeUndefined();
  });
});
