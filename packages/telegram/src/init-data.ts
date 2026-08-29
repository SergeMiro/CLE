import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramIdentity {
  id: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface VerifiedInitData {
  identity: TelegramIdentity;
  authDate: Date;
  queryId?: string;
  replayKey: string;
}

export class TelegramInitDataError extends Error {}

/** Verifies the raw Telegram.WebApp.initData HMAC and freshness; never accepts initDataUnsafe. */
export function verifyTelegramInitData(rawInitData: string, botToken: string, now = new Date(), maxAgeSeconds = 3600): VerifiedInitData {
  const params = new URLSearchParams(rawInitData);
  const suppliedHash = params.get('hash');
  const authDateText = params.get('auth_date');
  const userJson = params.get('user');
  if (!suppliedHash || !authDateText || !userJson) throw new TelegramInitDataError('initData is missing required fields');
  if (!/^\d+$/.test(authDateText)) throw new TelegramInitDataError('auth_date is invalid');

  const authDate = new Date(Number(authDateText) * 1000);
  if (Number.isNaN(authDate.getTime()) || (now.getTime() - authDate.getTime()) / 1000 > maxAgeSeconds || authDate > now) {
    throw new TelegramInitDataError('initData is expired or from the future');
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const expected = Buffer.from(expectedHash, 'hex');
  const supplied = Buffer.from(suppliedHash, 'hex');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new TelegramInitDataError('initData signature is invalid');

  let decoded: unknown;
  try { decoded = JSON.parse(userJson); } catch { throw new TelegramInitDataError('initData user is not JSON'); }
  if (!decoded || typeof decoded !== 'object' || !('id' in decoded) || (typeof decoded.id !== 'number' && typeof decoded.id !== 'string')) {
    throw new TelegramInitDataError('initData user is invalid');
  }
  const user = decoded as { id: number | string; username?: unknown; first_name?: unknown; last_name?: unknown };
  return {
    identity: {
      id: BigInt(user.id),
      ...(typeof user.username === 'string' ? { username: user.username } : {}),
      ...(typeof user.first_name === 'string' ? { firstName: user.first_name } : {}),
      ...(typeof user.last_name === 'string' ? { lastName: user.last_name } : {}),
    },
    authDate,
    ...(params.get('query_id') ? { queryId: params.get('query_id')! } : {}),
    replayKey: suppliedHash,
  };
}

