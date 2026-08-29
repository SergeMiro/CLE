import { PrismaClient } from '@cle/db';
import { MockAIProvider } from '@cle/ai';
import { MockTelegramClient } from '@cle/telegram';
import { MockTonPayoutProvider } from '@cle/ton';
import { parseEnvironment } from '@cle/config';
import type { FastifyInstance } from 'fastify';
import { createApi } from '../src/app.js';
import { buildContext, type AppContext } from '../src/context.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://cle:cle@localhost:5432/cle_test?schema=public';

export const testEnvironment = (overrides: NodeJS.ProcessEnv = {}) =>
  parseEnvironment({
    NODE_ENV: 'test',
    APP_MODE: 'mock',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: 'redis://localhost:6380',
    API_URL: 'http://localhost:4101',
    MINI_APP_URL: 'http://localhost:4100',
    SESSION_SECRET: 'x'.repeat(40),
    // Tests move the clock forward by weeks; session expiry is covered by its own test.
    SESSION_TTL_HOURS: '720', // the configuration maximum; a test that moves further signs in again
    MIN_WITHDRAWAL_NANOTON: '100000000',
    TELEGRAM_BOT_USERNAME: 'cle_test_bot',
    PLATFORM_ADMIN_TELEGRAM_IDS: '900001',
    ...overrides,
  });

export interface TestHarness {
  app: FastifyInstance;
  ctx: AppContext;
  telegram: MockTelegramClient;
  payouts: MockTonPayoutProvider;
  ai: MockAIProvider;
  prisma: PrismaClient;
  setNow: (value: Date) => void;
  close: () => Promise<void>;
}

/** Tables are truncated in dependency-free order using a single CASCADE statement. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createHarness(overrides: NodeJS.ProcessEnv = {}): Promise<TestHarness> {
  const env = testEnvironment(overrides);
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  await resetDatabase(prisma);

  const telegram = new MockTelegramClient();
  const payouts = new MockTonPayoutProvider('testnet');
  const ai = new MockAIProvider();
  let now = new Date('2026-09-01T12:00:00Z');

  const ctx = buildContext({ env, prisma, telegram, ai, payouts, now: () => now });
  const app = await createApi({ ctx, logger: false });
  await app.ready();

  return {
    app,
    ctx,
    telegram,
    payouts,
    ai,
    prisma,
    setNow: (value: Date) => {
      now = value;
    },
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

export interface ApiCall {
  method: 'GET' | 'POST';
  url: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function call(harness: TestHarness, options: ApiCall) {
  const response = await harness.app.inject({
    method: options.method,
    url: options.url,
    ...(options.body === undefined ? {} : { payload: options.body as never }),
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
  });
  let json: any;
  try {
    json = response.json();
  } catch {
    json = undefined;
  }
  return { status: response.statusCode, body: json as any };
}

/** Signs in with the mock initData shortcut and returns the session token. */
export async function signIn(harness: TestHarness, telegramId: number, username?: string, startParam?: string) {
  const result = await call(harness, {
    method: 'POST',
    url: '/api/v1/auth/telegram',
    body: { initData: `mock:${telegramId}${username ? `:${username}` : ''}`, ...(startParam ? { startParam } : {}) },
  });
  if (result.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(result.body)}`);
  return { token: result.body.token as string, user: result.body.user };
}

export const CHANNEL_CHAT_ID = -1002001001;

/** Puts a channel into the mock Telegram world with the bot as a full administrator. */
export function seedTelegramChannel(harness: TestHarness, chatId = CHANNEL_CHAT_ID, username = 'science_daily_test') {
  harness.telegram.setChat({ id: chatId, type: 'channel', title: 'Science Daily Test', username });
  harness.telegram.setMember(chatId, harness.telegram.state.me.id, {
    user: harness.telegram.state.me,
    status: 'administrator',
    can_post_messages: true,
    can_edit_messages: true,
    can_delete_messages: true,
    can_invite_users: true,
  });
  harness.telegram.setMemberCount(chatId, 1200);
}

export function joinChannel(harness: TestHarness, telegramId: number, chatId = CHANNEL_CHAT_ID) {
  harness.telegram.setMember(chatId, telegramId, { user: { id: telegramId }, status: 'member' });
}

export function leaveChannel(harness: TestHarness, telegramId: number, chatId = CHANNEL_CHAT_ID) {
  harness.telegram.setMember(chatId, telegramId, { user: { id: telegramId }, status: 'left' });
}

export const SCIENCE_POST = [
  'Astronomers using the James Webb Space Telescope have detected carbon dioxide in the atmosphere of the exoplanet WASP-39b.',
  'The planet orbits a sun-like star roughly seven hundred light-years from Earth and completes an orbit in four days.',
  'The detection was made with the NIRSpec instrument, which measures how starlight is absorbed as it passes through the atmosphere.',
  'Carbon dioxide is an important tracer of how a planet formed and how much heavy material it collected during its formation.',
].join(' ');
