import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TelegramInitDataError, verifyTelegramInitData } from '../src/index.js';

const token = '123456:token-for-unit-test';
const now = new Date('2026-08-29T10:00:00Z');
function signedInitData(user = { id: 42, first_name: 'Ada' }, authDate = Math.floor(now.getTime() / 1000)): string {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAE', user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

describe('Telegram initData verifier', () => {
  it('accepts correctly signed raw initData and extracts identity', () => expect(verifyTelegramInitData(signedInitData(), token, now).identity).toMatchObject({ id: 42n, firstName: 'Ada' }));
  it('rejects a tampered user', () => expect(() => verifyTelegramInitData(signedInitData().replace('Ada', 'Mallory'), token, now)).toThrow(TelegramInitDataError));
  it('rejects old initData', () => expect(() => verifyTelegramInitData(signedInitData(undefined, Math.floor(now.getTime() / 1000) - 3601), token, now)).toThrow(/expired/));
  it('rejects invalid signature', () => expect(() => verifyTelegramInitData(signedInitData(), `${token}x`, now)).toThrow(/signature/));
});

