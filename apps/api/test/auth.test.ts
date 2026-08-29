import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { InMemoryReplayStore, TelegramAuthService, type UserRepository } from '../src/auth.js';

const token = '123456:test-token';
const now = new Date('2026-08-29T10:00:00Z');
function initData(): string {
  const parameters = new URLSearchParams({ auth_date: String(Math.floor(now.getTime() / 1000)), user: JSON.stringify({ id: 123, first_name: 'Grace' }) });
  const check = [...parameters.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  parameters.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(token).digest()).update(check).digest('hex'));
  return parameters.toString();
}
const users: UserRepository = { async upsertTelegramUser(identity) { return { id: `user-${identity.id}`, telegramId: identity.id }; } };
async function api() { return createApi({ auth: new TelegramAuthService({ botToken: token, users, replays: new InMemoryReplayStore(), now: () => now }), sessionSecret: 's'.repeat(32) }); }

describe('Telegram auth endpoint', () => {
  it('authenticates verified initData, persists identity and creates an httpOnly session', async () => {
    const app = await api();
    const result = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: initData() } });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ user: { id: 'user-123', telegramId: '123' } }); expect(result.headers['set-cookie']).toContain('HttpOnly');
    await app.close();
  });
  it('rejects replayed initData before a second user write', async () => {
    const app = await api(); const payload = { initData: initData() };
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload })).statusCode).toBe(401);
    await app.close();
  });
  it('rejects missing initData', async () => { const app = await api(); expect((await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: {} })).statusCode).toBe(400); await app.close(); });
});
