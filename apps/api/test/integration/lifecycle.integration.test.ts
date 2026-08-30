import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTon } from '@cle/core';
import {
  CHANNEL_CHAT_ID,
  SCIENCE_POST,
  type TestHarness,
  call,
  createHarness,
  joinChannel,
  seedTelegramChannel,
  signIn,
} from '../helpers.js';

/**
 * The whole product in one pass: a creator connects a channel, a member joins,
 * a post becomes a quiz, revenue is split 10% / creator / community, rewards are
 * calculated and paid, and the member withdraws to TON.
 */
describe('CLE end-to-end lifecycle', () => {
  let harness: TestHarness;
  let creator: { token: string; user: any };
  let member: { token: string; user: any };
  let admin: { token: string; user: any };
  let organizationId: string;
  let channelId: string;
  let communityId: string;
  let quizId: string;

  const CREATOR_TG = 500_001;
  const MEMBER_TG = 500_002;
  const ADMIN_TG = 900_001;

  beforeAll(async () => {
    harness = await createHarness();
    seedTelegramChannel(harness);
    creator = await signIn(harness, CREATOR_TG, 'creator_one');
    member = await signIn(harness, MEMBER_TG, 'learner_one');
    admin = await signIn(harness, ADMIN_TG, 'cle_admin');
  });

  afterAll(async () => {
    await harness.close();
  });

  it('signs a Telegram user in and issues a session', async () => {
    const me = await call(harness, { method: 'GET', url: '/api/v1/me', token: creator.token });
    expect(me.status).toBe(200);
    expect(me.body.telegramId).toBe(String(CREATOR_TG));
    expect(me.body.referralCode).toMatch(/^[A-Z0-9]{10}$/);
    expect(me.body.isCreator).toBe(false);
  });

  it('refuses an unauthenticated request', async () => {
    expect((await call(harness, { method: 'GET', url: '/api/v1/me' })).status).toBe(401);
  });

  it('promotes a configured platform administrator', async () => {
    const me = await call(harness, { method: 'GET', url: '/api/v1/me', token: admin.token });
    expect(me.body.isPlatformAdmin).toBe(true);
  });

  it('creates an organization owned by the creator', async () => {
    const created = await call(harness, {
      method: 'POST',
      url: '/api/v1/organizations',
      token: creator.token,
      body: { name: 'Science Media Ltd' },
    });
    expect(created.status).toBe(200);
    organizationId = created.body.id;
    expect(created.body.slug).toBe('science-media-ltd');

    const list = await call(harness, { method: 'GET', url: '/api/v1/organizations', token: creator.token });
    expect(list.body).toHaveLength(1);
    expect(list.body[0].role).toBe('OWNER');
  });

  it('connects a Telegram channel and reports the bot permissions', async () => {
    const connected = await call(harness, {
      method: 'POST',
      url: `/api/v1/organizations/${organizationId}/channels`,
      token: creator.token,
      body: { reference: '@science_daily_test' },
    });
    expect(connected.status).toBe(200);
    expect(connected.body.status).toBe('ACTIVE');
    expect(connected.body.botIsAdmin).toBe(true);
    expect(connected.body.missingRequired).toEqual([]);
    channelId = connected.body.channel.id;
  });

  it('refuses to connect a channel where the bot is not an administrator', async () => {
    harness.telegram.setChat({ id: -1002999999, type: 'channel', title: 'Foreign', username: 'foreign_test' });
    const connected = await call(harness, {
      method: 'POST',
      url: `/api/v1/organizations/${organizationId}/channels`,
      token: creator.token,
      body: { reference: '@foreign_test' },
    });
    expect(connected.body.status).toBe('PENDING');
    expect(connected.body.missingRequired).toContain('can_post_messages');
  });

  it('creates a community with default policies and launches it', async () => {
    const created = await call(harness, {
      method: 'POST',
      url: '/api/v1/communities',
      token: creator.token,
      body: { channelId, name: 'Science Daily CLE Community', creatorShareBps: 500 },
    });
    expect(created.status).toBe(200);
    communityId = created.body.id;

    const policies = await call(harness, { method: 'GET', url: `/api/v1/communities/${communityId}/policies`, token: creator.token });
    expect(policies.body.platform.platformFeeBps).toBe(1000);
    expect(policies.body.revenue.creatorShareBps).toBe(500);
    expect(policies.body.reward.growthBps).toBe(3500);
    expect(policies.body.quiz.enabled).toBe(false);

    const launched = await call(harness, { method: 'POST', url: `/api/v1/communities/${communityId}/launch`, token: creator.token });
    expect(launched.body.status).toBe('ACTIVE');
  });

  it('rejects a creator share above the platform ceiling', async () => {
    const rejected = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/policies/revenue`,
      token: creator.token,
      body: { creatorShareBps: 2500 },
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.message).toMatch(/platform maximum/);
  });

  it('records a member joining the channel', async () => {
    joinChannel(harness, MEMBER_TG);
    const synced = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/membership/sync`,
      token: member.token,
      body: {},
    });
    expect(synced.status).toBe(200);
    expect(synced.body.status).toBe('ACTIVE');
    expect(synced.body.changed).toBe(true);

    const communities = await call(harness, { method: 'GET', url: '/api/v1/me/communities', token: member.token });
    expect(communities.body[0].community.slug).toBe('science-daily-test');
  });

  it('turns a channel post into a published quiz', async () => {
    await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/policies/quiz`,
      token: creator.token,
      body: { enabled: true, mode: 'AUTO', questionsPerQuiz: 3, minimumPostLength: 100 },
    });

    const webhook = await call(harness, {
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      body: {
        update_id: 1,
        channel_post: {
          message_id: 4242,
          date: Math.floor(new Date('2026-09-01T11:00:00Z').getTime() / 1000),
          chat: { id: CHANNEL_CHAT_ID, type: 'channel', title: 'Science Daily Test', username: 'science_daily_test' },
          text: SCIENCE_POST,
        },
      },
    });
    expect(webhook.status).toBe(200);
    expect(webhook.body.detail).toBe('quiz published');

    const quizzes = await call(harness, { method: 'GET', url: `/api/v1/communities/${communityId}/quizzes`, token: creator.token });
    expect(quizzes.body).toHaveLength(1);
    quizId = quizzes.body[0].id;
    expect(quizzes.body[0].status).toBe('PUBLISHED');
    expect(quizzes.body[0]._count.questions).toBe(3);

    // The call to action really was posted into the channel.
    const posted = harness.telegram.state.sent.at(-1);
    expect(posted?.text).toContain('TEST YOUR KNOWLEDGE');
    expect(posted?.text).toContain('3 questions about the post above');
    expect(posted?.replyMarkup?.inline_keyboard[0]?.[0]?.url).toContain('startapp=q_');
  });

  it('never quizzes its own announcement', async () => {
    // The call to action CLE posted is delivered back as a channel_post; treating
    // it as content would generate a quiz about the quiz.
    const announcement = await harness.prisma.quiz.findFirstOrThrow({ where: { id: quizId }, select: { publishedMessageId: true } });
    const byMessageId = await call(harness, {
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      body: {
        update_id: 2,
        channel_post: {
          message_id: Number(announcement.publishedMessageId),
          date: Math.floor(Date.now() / 1000),
          chat: { id: CHANNEL_CHAT_ID, type: 'channel', username: 'science_daily_test' },
          text: SCIENCE_POST,
        },
      },
    });
    expect(byMessageId.body.detail).toBe('ignoring a quiz announcement');

    const byAuthor = await call(harness, {
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      body: {
        update_id: 3,
        channel_post: {
          message_id: 999_001,
          date: Math.floor(Date.now() / 1000),
          chat: { id: CHANNEL_CHAT_ID, type: 'channel', username: 'science_daily_test' },
          from: { id: 777_000, is_bot: true, username: 'cle_mock_bot' },
          text: SCIENCE_POST,
        },
      },
    });
    expect(byAuthor.body.detail).toContain("bot's own post");

    const quizzes = await call(harness, { method: 'GET', url: `/api/v1/communities/${communityId}/quizzes`, token: creator.token });
    expect(quizzes.body).toHaveLength(1);
  });

  it('ignores a redelivered Telegram update', async () => {
    const replay = await call(harness, {
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      body: {
        update_id: 1,
        channel_post: {
          message_id: 4242,
          date: 1,
          chat: { id: CHANNEL_CHAT_ID, type: 'channel' },
          text: SCIENCE_POST,
        },
      },
    });
    expect(replay.body.duplicate).toBe(true);
    const quizzes = await call(harness, { method: 'GET', url: `/api/v1/communities/${communityId}/quizzes`, token: creator.token });
    expect(quizzes.body).toHaveLength(1);
  });

  it('never sends the answer key to the client', async () => {
    const quiz = await call(harness, { method: 'GET', url: `/api/v1/quizzes/${quizId}`, token: member.token });
    expect(quiz.status).toBe(200);
    expect(JSON.stringify(quiz.body)).not.toContain('isCorrect');
    expect(quiz.body.questions).toHaveLength(3);
  });

  it('scores a quiz on the server and awards learning points', async () => {
    const quiz = await call(harness, { method: 'GET', url: `/api/v1/quizzes/${quizId}`, token: member.token });
    // The mock generator always puts the correct option first.
    const answers = quiz.body.questions.map((question: any) => ({ questionId: question.id, optionId: question.options[0].id }));
    const result = await call(harness, { method: 'POST', url: `/api/v1/quizzes/${quizId}/submit`, token: member.token, body: { answers } });
    expect(result.status).toBe(200);
    expect(result.body.correctCount).toBe(3);
    expect(result.body.finalPoints).toBeGreaterThan(0);
    expect(result.body.review[0].explanation).toBeTruthy();

    const home = await call(harness, { method: 'GET', url: '/api/v1/me/home', token: member.token });
    expect(home.body.learningPoints).toBe(result.body.finalPoints);
    expect(home.body.quizzesCompleted).toBe(1);
  });

  it('refuses a second attempt at the same quiz', async () => {
    const quiz = await call(harness, { method: 'GET', url: `/api/v1/quizzes/${quizId}`, token: member.token });
    const answers = quiz.body.questions.map((question: any) => ({ questionId: question.id, optionId: question.options[1].id }));
    const repeat = await call(harness, { method: 'POST', url: `/api/v1/quizzes/${quizId}/submit`, token: member.token, body: { answers } });
    expect(repeat.status).toBe(409);
  });

  it('refuses to score a quiz for someone who is not in the channel', async () => {
    const outsider = await signIn(harness, 500_099, 'outsider');
    const quiz = await call(harness, { method: 'GET', url: `/api/v1/quizzes/${quizId}`, token: outsider.token });
    // The quiz says up front that this person may not answer.
    expect(quiz.body.canAnswer).toBe(false);
    expect(quiz.body.channelUsername).toBe('science_daily_test');
    const answers = quiz.body.questions.map((question: any) => ({ questionId: question.id, optionId: question.options[0].id }));
    const denied = await call(harness, { method: 'POST', url: `/api/v1/quizzes/${quizId}/submit`, token: outsider.token, body: { answers } });
    expect(denied.status).toBe(403);
  });


  it('splits revenue as 10% platform fee, 5% creator, the rest to the community', async () => {
    const recorded = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/revenue`,
      token: creator.token,
      body: {
        source: 'telegram_ads',
        amountNanoton: parseTon('100').toString(),
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-30T00:00:00.000Z',
        externalReference: 'tg-ads-2026-09',
      },
    });
    expect(recorded.body.status).toBe('OBSERVED');

    const funded = await call(harness, {
      method: 'POST',
      url: `/api/v1/revenue/${recorded.body.id}/status`,
      token: creator.token,
      body: { status: 'FUNDED' },
    });
    expect(funded.body.status).toBe('FUNDED');

    const cycle = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/revenue-cycles`,
      token: creator.token,
      body: { periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-09-30T00:00:00.000Z' },
    });
    expect(cycle.status).toBe(200);
    expect(cycle.body.cycle.grossNanoton).toBe(parseTon('100').toString());
    expect(cycle.body.cycle.platformFeeNanoton).toBe(parseTon('10').toString());
    expect(cycle.body.cycle.creatorShareNanoton).toBe(parseTon('4.5').toString());
    expect(cycle.body.cycle.communityShareNanoton).toBe(parseTon('85.5').toString());
  });

  it('pays the community share out to members and keeps the ledger balanced', async () => {
    const cycles = await call(harness, { method: 'GET', url: `/api/v1/communities/${communityId}/revenue-cycles`, token: creator.token });
    const revenueCycleId = cycles.body[0].id;

    // The period is closed after it ends; by 30 September the member is 29 days
    // old and past the seven-day new-member hold.
    harness.setNow(new Date('2026-09-30T18:00:00Z'));

    const rewardCycle = await call(harness, {
      method: 'POST',
      url: `/api/v1/revenue-cycles/${revenueCycleId}/reward-cycle`,
      token: creator.token,
      body: {},
    });
    const cycleId = rewardCycle.body.id;
    expect(rewardCycle.body.distributableNanoton).toBe(parseTon('85.5').toString());

    const calculated = await call(harness, { method: 'POST', url: `/api/v1/reward-cycles/${cycleId}/calculate`, token: creator.token, body: {} });
    expect(calculated.body.status).toBe('CALCULATED');

    const detail = await call(harness, { method: 'GET', url: `/api/v1/reward-cycles/${cycleId}`, token: creator.token });
    const pools = Object.fromEntries(detail.body.pools.map((pool: any) => [pool.type, pool]));
    expect(pools.GROWTH.amountNanoton).toBe(parseTon('29.925').toString());
    expect(pools.LOYALTY.amountNanoton).toBe(parseTon('34.2').toString());
    // Nobody referred anyone, so the referral pool is carried, not redistributed.
    expect(pools.REFERRAL.distributedNanoton).toBe('0');
    expect(pools.REFERRAL.carriedNanoton).toBe(parseTon('12.825').toString());

    await call(harness, { method: 'POST', url: `/api/v1/reward-cycles/${cycleId}/approve`, token: creator.token, body: {} });
    const finalized = await call(harness, { method: 'POST', url: `/api/v1/reward-cycles/${cycleId}/finalize`, token: creator.token, body: {} });
    expect(finalized.body.cycle.status).toBe('FINALIZED');
    expect(finalized.body.unlockedAllocations).toBeGreaterThan(0);

    const home = await call(harness, { method: 'GET', url: '/api/v1/me/home', token: member.token });
    // The only eligible member takes the growth, loyalty and learning pools.
    expect(home.body.balance.available).toBe(parseTon('72.675').toString());
    expect(home.body.communities[0].availableNanoton).toBe(parseTon('72.675').toString());

    const health = await call(harness, { method: 'GET', url: '/api/v1/admin/ledger/health', token: admin.token });
    expect(health.body.balanced).toBe(true);
    expect(health.body.negativeCustodyAccounts).toEqual([]);
  });

  it('refuses to recalculate a finalized cycle', async () => {
    const cycles = await call(harness, { method: 'GET', url: `/api/v1/communities/${communityId}/revenue-cycles`, token: creator.token });
    const cycleId = cycles.body[0].rewardCycle.id;
    const rejected = await call(harness, { method: 'POST', url: `/api/v1/reward-cycles/${cycleId}/calculate`, token: creator.token, body: {} });
    expect(rejected.status).toBe(409);
  });

  it('lets the member link a wallet and withdraw the whole balance', async () => {
    const wallet = await call(harness, {
      method: 'POST',
      url: '/api/v1/me/wallets',
      token: member.token,
      body: { address: '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8' },
    });
    expect(wallet.status).toBe(200);
    expect(wallet.body.isPrimary).toBe(true);

    const withdrawal = await call(harness, {
      method: 'POST',
      url: '/api/v1/me/withdrawals',
      token: member.token,
      body: { amountNanoton: parseTon('72.675').toString() },
    });
    expect(withdrawal.status).toBe(200);
    expect(withdrawal.body.status).toBe('LOCKED');

    const afterLock = await call(harness, { method: 'GET', url: '/api/v1/me/home', token: member.token });
    expect(afterLock.body.balance.available).toBe('0');
    expect(afterLock.body.balance.locked).toBe(parseTon('72.675').toString());

    const processed = await call(harness, {
      method: 'POST',
      url: `/api/v1/admin/withdrawals/${withdrawal.body.id}/process`,
      token: admin.token,
      body: {},
    });
    expect(processed.body.status).toBe('CONFIRMED');
    expect(processed.body.txHash).toMatch(/^mock-/);

    const afterPayout = await call(harness, { method: 'GET', url: '/api/v1/me/home', token: member.token });
    expect(afterPayout.body.balance).toMatchObject({ available: '0', locked: '0', pending: '0' });

    const health = await call(harness, { method: 'GET', url: '/api/v1/admin/ledger/health', token: admin.token });
    expect(health.body.balanced).toBe(true);
  });

  it('refuses a withdrawal below the platform minimum and one without funds', async () => {
    const tooSmall = await call(harness, { method: 'POST', url: '/api/v1/me/withdrawals', token: member.token, body: { amountNanoton: '1000' } });
    expect(tooSmall.status).toBe(422);

    const tooLarge = await call(harness, {
      method: 'POST',
      url: '/api/v1/me/withdrawals',
      token: member.token,
      body: { amountNanoton: parseTon('5').toString() },
    });
    expect(tooLarge.status).toBe(422);
    expect(tooLarge.body.message).toMatch(/insufficient/);
  });

  it('recognises a subscriber CLE has never seen before, without asking them to press anything', async () => {
    // Someone already subscribed when the bot was added generates no chat_member
    // update, so CLE has no record of them. Opening a quiz from the channel must
    // still work: the membership is resolved with Telegram on the spot. Runs last
    // because it adds an eligible member to the community.
    const veteran = await signIn(harness, 500_500, 'veteran');
    joinChannel(harness, 500_500);
    const quiz = await call(harness, { method: 'GET', url: `/api/v1/quizzes/${quizId}`, token: veteran.token });
    expect(quiz.body.canAnswer).toBe(true);
    expect(quiz.body.membershipStatus).toBe('ACTIVE');

    const answers = quiz.body.questions.map((question: any) => ({ questionId: question.id, optionId: question.options[0].id }));
    const scored = await call(harness, { method: 'POST', url: `/api/v1/quizzes/${quizId}/submit`, token: veteran.token, body: { answers } });
    expect(scored.status).toBe(200);
    expect(scored.body.correctCount).toBe(3);
  });

  it('reports the creator and platform view of the same money', async () => {
    const overview = await call(harness, { method: 'GET', url: `/api/v1/organizations/${organizationId}/overview`, token: creator.token });
    expect(overview.body.grossRevenueNanoton).toBe(parseTon('100').toString());
    expect(overview.body.creatorEarnedNanoton).toBe(parseTon('4.5').toString());
    expect(overview.body.creatorAvailableNanoton).toBe(parseTon('4.5').toString());

    const platform = await call(harness, { method: 'GET', url: '/api/v1/admin/overview', token: admin.token });
    expect(platform.body.platformFeeNanoton).toBe(parseTon('10').toString());
    expect(platform.body.platformTreasuryNanoton).toBe(parseTon('10').toString());
    expect(platform.body.withdrawalsConfirmedNanoton).toBe(parseTon('72.675').toString());
  });

  it('edits one quiz setting without resetting the others', async () => {
    const enable = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/policies/quiz`,
      token: creator.token,
      body: { enabled: true, mode: 'AUTO', questionsPerQuiz: 4, language: 'ru', minimumPostLength: 120, publishButtonText: 'ОТВЕТИТЬ' },
    });
    expect(enable.status).toBe(200);

    // The creator only moves the delay; everything else must survive.
    const delayed = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/policies/quiz`,
      token: creator.token,
      body: { quizDelayMinutes: 15 },
    });
    expect(delayed.status).toBe(200);
    expect(delayed.body.quizDelayMinutes).toBe(15);
    expect(delayed.body.enabled).toBe(true);
    expect(delayed.body.mode).toBe('AUTO');
    expect(delayed.body.questionsPerQuiz).toBe(4);
    expect(delayed.body.language).toBe('ru');
    expect(delayed.body.minimumPostLength).toBe(120);
    expect(delayed.body.publishButtonText).toBe('ОТВЕТИТЬ');

    const reward = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/policies/reward`,
      token: creator.token,
      body: { growthBps: 3500, loyaltyBps: 4000, referralBps: 1500, learningBps: 1000, newMemberHoldDays: 0 },
    });
    expect(reward.status).toBe(200);
    const reshared = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${communityId}/policies/reward`,
      token: creator.token,
      body: { growthBps: 3000, loyaltyBps: 4500, referralBps: 1500, learningBps: 1000 },
    });
    expect(reshared.status).toBe(200);
    expect(reshared.body.newMemberHoldDays).toBe(0);
  });
});
