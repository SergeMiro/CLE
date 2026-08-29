import { parseTon } from '@cle/core';
import { loadEnvironment } from '@cle/config';
import { FileMockTelegramClient } from '@cle/telegram';
import { buildContext } from '../context.js';
import { connectChannel } from '../services/channels.js';
import { createCommunity, launchCommunity } from '../services/communities.js';
import { ingestChannelPost } from '../services/content.js';
import { upsertTelegramUser } from '../services/identity.js';
import { syncMembership } from '../services/membership.js';
import { createQuizPolicyVersion } from '../services/policies.js';
import { generateQuizForContent, publishQuiz, submitQuizAttempt } from '../services/quizzes.js';
import { createOrganization } from '../services/organizations.js';
import { openRevenueCycle, recordRevenue, setRevenueStatus } from '../services/revenue.js';
import { approveCycle, calculateCycle, createRewardCycle, finalizeCycle, unlockDueAllocations } from '../services/rewards.js';

/**
 * Builds a complete, believable CLE world in APP_MODE=mock: one creator, one
 * channel with subscribers, a published quiz, a closed revenue cycle and paid
 * rewards.
 *
 * Running it again is a no-op: financial history is append-only and is never
 * deleted to make room for a new demo. Pass --reset to empty the database first
 * (mock mode only) and build the world from scratch.
 */
const CHANNEL_CHAT_ID = -1002500100;
const CREATOR_TELEGRAM_ID = 111_000_001;
const MEMBER_TELEGRAM_IDS = [111_000_101, 111_000_102, 111_000_103];
/** Joins the channel but answers nothing, so a quiz can be taken by hand straight away. */
const FRESH_MEMBER_TELEGRAM_ID = 111_000_104;

const env = loadEnvironment();
if (env.APP_MODE !== 'mock') {
  console.error('seed-demo only runs with APP_MODE=mock — it fabricates Telegram data.');
  process.exit(1);
}

const ctx = buildContext({ env });
const telegram = ctx.telegram as FileMockTelegramClient;

const SCIENCE_POSTS = [
  [
    'Astronomers using the James Webb Space Telescope have detected carbon dioxide in the atmosphere of the exoplanet WASP-39b.',
    'The planet orbits a sun-like star roughly seven hundred light-years from Earth and completes one orbit every four days.',
    'The detection was made with the NIRSpec instrument, which measures how starlight is absorbed as it passes through an atmosphere.',
    'Carbon dioxide is a tracer of how a planet formed and how much heavy material it collected while forming.',
  ].join(' '),
  [
    'A study of Greenland ice cores has reconstructed atmospheric dust levels over the past eighty thousand years.',
    'Dust concentrations were up to twenty times higher during the coldest glacial periods than they are today.',
    'The dust carried iron into the Southern Ocean, fertilising plankton blooms that pulled carbon out of the air.',
    'The record helps calibrate the climate models used to project the next century of warming.',
  ].join(' '),
];

async function resetDatabase(): Promise<void> {
  const tables = await ctx.prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  await ctx.prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((row) => `"public"."${row.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('· --reset: emptying the mock database');
    await resetDatabase();
  }

  const existingChannel = await ctx.prisma.telegramChannel.findUnique({
    where: { telegramChatId: BigInt(CHANNEL_CHAT_ID) },
    include: { community: true },
  });
  if (existingChannel?.community) {
    console.log('The demo world already exists; nothing was changed.');
    console.log('Run with --reset to rebuild it from an empty database.');
    printLinks();
    return;
  }

  console.log('· building the simulated Telegram channel');
  const me = await telegram.getMe();
  telegram.setChat({ id: CHANNEL_CHAT_ID, type: 'channel', title: 'Science Daily', username: 'cle_science_daily' });
  telegram.setMember(CHANNEL_CHAT_ID, me.id, {
    user: me,
    status: 'administrator',
    can_post_messages: true,
    can_edit_messages: true,
    can_delete_messages: true,
    can_invite_users: true,
  });
  telegram.setMemberCount(CHANNEL_CHAT_ID, 4820);
  for (const telegramId of [...MEMBER_TELEGRAM_IDS, FRESH_MEMBER_TELEGRAM_ID]) {
    telegram.setMember(CHANNEL_CHAT_ID, telegramId, { user: { id: telegramId }, status: 'member' });
  }

  console.log('· creating the creator, organization, channel and community');
  const creator = await upsertTelegramUser(ctx, { id: BigInt(CREATOR_TELEGRAM_ID), username: 'demo_creator', firstName: 'Demo Creator' });
  const actor = { id: creator.id, isPlatformAdmin: creator.isPlatformAdmin };
  const organization = await createOrganization(ctx, actor, { name: 'Science Media Demo' });
  const channel = await connectChannel(ctx, actor, organization.id, { reference: '@cle_science_daily' });
  const community = await createCommunity(ctx, actor, { channelId: channel.channel.id, name: 'Science Daily CLE', creatorShareBps: 500 });
  await launchCommunity(ctx, actor, community.id);
  await createQuizPolicyVersion(ctx, {
    communityId: community.id,
    enabled: true,
    mode: 'AUTO',
    questionsPerQuiz: 3,
    minimumPostLength: 150,
    effectiveFrom: new Date(0),
  });

  console.log('· joining members');
  const members = [];
  for (const [index, telegramId] of MEMBER_TELEGRAM_IDS.entries()) {
    const user = await upsertTelegramUser(ctx, { id: BigInt(telegramId), username: `learner_${index + 1}`, firstName: `Learner ${index + 1}` });
    // Backdate the join so members are past the new-member hold and reward-eligible.
    await syncMembership(ctx, {
      communityId: community.id,
      userId: user.id,
      source: 'ONBOARDING_CHECK',
      observedAt: new Date(ctx.now().getTime() - (60 - index * 10) * 86_400_000),
    });
    members.push(user);
  }

  const freshMember = await upsertTelegramUser(ctx, {
    id: BigInt(FRESH_MEMBER_TELEGRAM_ID),
    username: 'learner_fresh',
    firstName: 'New Learner',
  });
  await syncMembership(ctx, {
    communityId: community.id,
    userId: freshMember.id,
    source: 'ONBOARDING_CHECK',
    observedAt: new Date(ctx.now().getTime() - 20 * 86_400_000),
  });

  console.log('· ingesting posts and publishing quizzes');
  const quizIds: string[] = [];
  for (const [index, text] of SCIENCE_POSTS.entries()) {
    const ingested = await ingestChannelPost(ctx, community.id, {
      message_id: 9000 + index,
      date: Math.floor((ctx.now().getTime() - (5 - index) * 86_400_000) / 1000),
      chat: { id: CHANNEL_CHAT_ID, type: 'channel', username: 'cle_science_daily' },
      text,
    });
    if (!ingested.quizRequested) {
      console.log(`  · post ${index + 1} skipped: ${ingested.skipReason}`);
      continue;
    }
    const generated = await generateQuizForContent(ctx, ingested.item.id);
    const published = await publishQuiz(ctx, generated.quiz.id);
    quizIds.push(published.quiz.id);
  }

  console.log('· members answering quizzes');
  for (const [memberIndex, member] of members.entries()) {
    for (const quizId of quizIds) {
      const quiz = await ctx.prisma.quiz.findUniqueOrThrow({
        where: { id: quizId },
        include: { questions: { include: { options: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } } },
      });
      const answers = quiz.questions.map((question, questionIndex) => {
        // The first two members answer correctly; the third gets one wrong.
        const wrong = memberIndex === 2 && questionIndex === 0;
        const option = wrong ? question.options.find((candidate) => !candidate.isCorrect) : question.options.find((candidate) => candidate.isCorrect);
        return { questionId: question.id, optionId: (option ?? question.options[0]!).id };
      });
      await submitQuizAttempt(ctx, member.id, quizId, answers).catch((error) => {
        console.log(`  · ${member.telegramUsername} could not answer: ${error instanceof Error ? error.message : error}`);
      });
    }
  }

  console.log('· recording revenue and paying out rewards');
  const periodStart = new Date(ctx.now().getTime() - 30 * 86_400_000);
  const periodEnd = ctx.now();
  const entry = await recordRevenue(ctx, actor, {
    communityId: community.id,
    source: 'telegram_ads',
    amountNanoton: parseTon('100'),
    periodStart,
    periodEnd,
    externalReference: `demo-${periodStart.toISOString().slice(0, 10)}`,
  });
  await setRevenueStatus(ctx, actor, entry.id, 'FUNDED');
  const revenueCycle = await openRevenueCycle(ctx, actor, { communityId: community.id, periodStart, periodEnd });
  const rewardCycle = await createRewardCycle(ctx, actor, revenueCycle.cycle.id);
  await calculateCycle(ctx, actor, rewardCycle.id);
  await approveCycle(ctx, actor, rewardCycle.id);
  await finalizeCycle(ctx, actor, rewardCycle.id);
  const unlocked = await unlockDueAllocations(ctx, community.id);

  const cycle = await ctx.prisma.revenueCycle.findUniqueOrThrow({ where: { id: revenueCycle.cycle.id } });
  console.log('\nDemo ready.');
  console.log('─'.repeat(64));
  console.log(`Channel            @cle_science_daily (chat ${CHANNEL_CHAT_ID})`);
  console.log(`Community          ${community.name} (${community.slug})`);
  console.log(`Gross revenue      100 TON`);
  console.log(`CLE fee            ${Number(cycle.platformFeeNanoton) / 1e9} TON`);
  console.log(`Creator share      ${Number(cycle.creatorShareNanoton) / 1e9} TON`);
  console.log(`Community share    ${Number(cycle.communityShareNanoton) / 1e9} TON`);
  console.log(`Quizzes published  ${quizIds.length}`);
  console.log(`Allocations paid   ${unlocked}`);
  console.log('─'.repeat(64));
  printLinks();
}

function printLinks(): void {
  console.log('Open the Mini App as:');
  console.log(`  creator   ${env.MINI_APP_URL}/creator?mockUser=${CREATOR_TELEGRAM_ID}`);
  for (const [index, telegramId] of MEMBER_TELEGRAM_IDS.entries()) {
    console.log(`  learner ${index + 1} ${env.MINI_APP_URL}?mockUser=${telegramId}`);
  }
  console.log(`  new learner (no quizzes answered yet) ${env.MINI_APP_URL}/learn?mockUser=${FRESH_MEMBER_TELEGRAM_ID}`);
  if (env.PLATFORM_ADMIN_TELEGRAM_IDS) {
    console.log(`  admin     ${env.MINI_APP_URL}/admin?mockUser=${env.PLATFORM_ADMIN_TELEGRAM_IDS.split(',')[0]?.trim()}`);
  }
}

await main();
await ctx.prisma.$disconnect();
process.exit(0);
