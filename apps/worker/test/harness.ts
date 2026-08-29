import { MockAIProvider } from '@cle/ai';
import { type AppContext, buildContext, connectChannel, createCommunity, createOrganization, upsertTelegramUser } from '@cle/api';
import { parseEnvironment } from '@cle/config';
import { PrismaClient } from '@cle/db';
import { MockTelegramClient } from '@cle/telegram';
import { MockTonPayoutProvider } from '@cle/ton';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://cle:cle@localhost:5432/cle_test?schema=public';
export const CHANNEL_CHAT_ID = -1002777001;

export interface WorkerHarness {
  ctx: AppContext;
  prisma: PrismaClient;
  telegram: MockTelegramClient;
  payouts: MockTonPayoutProvider;
  setNow: (value: Date) => void;
  close: () => Promise<void>;
}

export async function createWorkerHarness(): Promise<WorkerHarness> {
  const env = parseEnvironment({
    NODE_ENV: 'test',
    APP_MODE: 'mock',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: 'redis://localhost:6380',
    API_URL: 'http://localhost:4101',
    MINI_APP_URL: 'http://localhost:4100',
    SESSION_SECRET: 'w'.repeat(40),
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
  const payouts = new MockTonPayoutProvider('testnet');
  let now = new Date('2026-09-01T12:00:00Z');
  const ctx = buildContext({ env, prisma, telegram, payouts, ai: new MockAIProvider(), now: () => now });

  return {
    ctx,
    prisma,
    telegram,
    payouts,
    setNow: (value) => {
      now = value;
    },
    close: async () => {
      await prisma.$disconnect();
    },
  };
}

/** Builds a launched community with an admin bot, ready for maintenance jobs. */
export async function seedCommunity(harness: WorkerHarness, telegramId = 700_001) {
  harness.telegram.setChat({ id: CHANNEL_CHAT_ID, type: 'channel', title: 'Worker Test', username: 'worker_test' });
  harness.telegram.setMember(CHANNEL_CHAT_ID, harness.telegram.state.me.id, {
    user: harness.telegram.state.me,
    status: 'administrator',
    can_post_messages: true,
    can_edit_messages: true,
    can_delete_messages: true,
    can_invite_users: true,
  });

  const user = await upsertTelegramUser(harness.ctx, { id: BigInt(telegramId), username: 'creator' });
  const actor = { id: user.id, isPlatformAdmin: false };
  const organization = await createOrganization(harness.ctx, actor, { name: 'Worker Media' });
  const channel = await connectChannel(harness.ctx, actor, organization.id, { reference: '@worker_test' });
  const community = await createCommunity(harness.ctx, actor, { channelId: channel.channel.id });
  await harness.prisma.community.update({ where: { id: community.id }, data: { status: 'ACTIVE', launchedAt: harness.ctx.now() } });
  return { actor, organization, channel: channel.channel, community };
}

export const LONG_POST = [
  'Researchers have mapped the deep ocean currents that move heat from the equator towards the poles.',
  'The measurements were collected by a fleet of autonomous floats over a period of six years.',
  'The circulation carries roughly a quarter of the heat that leaves the tropics every year.',
  'A slowdown in this circulation would change rainfall patterns across western Europe and west Africa.',
].join(' ');
