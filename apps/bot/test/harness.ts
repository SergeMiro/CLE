import { type AppContext, buildContext, connectChannel, createCommunity, createOrganization, upsertTelegramUser } from '@cle/api';
import { parseEnvironment } from '@cle/config';
import { PrismaClient } from '@cle/db';
import { MockTelegramClient } from '@cle/telegram';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://cle:cle@localhost:5432/cle_test?schema=public';
export const CHANNEL_CHAT_ID = -1002888001;

export interface BotHarness {
  ctx: AppContext;
  prisma: PrismaClient;
  telegram: MockTelegramClient;
  close: () => Promise<void>;
}

export async function createBotHarness(): Promise<BotHarness> {
  const env = parseEnvironment({
    NODE_ENV: 'test',
    APP_MODE: 'mock',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: 'redis://localhost:6380',
    API_URL: 'http://localhost:4101',
    MINI_APP_URL: 'http://localhost:4100',
    SESSION_SECRET: 'b'.repeat(40),
    MIN_WITHDRAWAL_NANOTON: '100000000',
    TELEGRAM_BOT_USERNAME: 'cle_test_bot',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((row) => `"public"."${row.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }

  const telegram = new MockTelegramClient();
  const ctx = buildContext({ env, prisma, telegram, now: () => new Date('2026-09-01T12:00:00Z') });
  return { ctx, prisma, telegram, close: async () => prisma.$disconnect() };
}

export async function seedCommunity(harness: BotHarness) {
  harness.telegram.setChat({ id: CHANNEL_CHAT_ID, type: 'channel', title: 'Bot Test', username: 'bot_test_channel' });
  harness.telegram.setMember(CHANNEL_CHAT_ID, harness.telegram.state.me.id, {
    user: harness.telegram.state.me,
    status: 'administrator',
    can_post_messages: true,
    can_edit_messages: true,
    can_delete_messages: true,
    can_invite_users: true,
  });
  const user = await upsertTelegramUser(harness.ctx, { id: 800_001n, username: 'creator' });
  const actor = { id: user.id, isPlatformAdmin: false };
  const organization = await createOrganization(harness.ctx, actor, { name: 'Bot Media' });
  const channel = await connectChannel(harness.ctx, actor, organization.id, { reference: '@bot_test_channel' });
  const community = await createCommunity(harness.ctx, actor, { channelId: channel.channel.id });
  await harness.prisma.community.update({ where: { id: community.id }, data: { status: 'ACTIVE' } });
  return { actor, organization, community };
}
