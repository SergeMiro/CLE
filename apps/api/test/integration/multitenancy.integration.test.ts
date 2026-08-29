import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTon } from '@cle/core';
import { type TestHarness, call, createHarness, joinChannel, leaveChannel, seedTelegramChannel, signIn } from '../helpers.js';

const CHANNEL_A = -1002001001;
const CHANNEL_B = -1002002002;

async function connectedCommunity(
  harness: TestHarness,
  token: string,
  organizationName: string,
  chatId: number,
  username: string,
): Promise<{ organizationId: string; channelId: string; communityId: string }> {
  seedTelegramChannel(harness, chatId, username);
  const organization = await call(harness, { method: 'POST', url: '/api/v1/organizations', token, body: { name: organizationName } });
  const channel = await call(harness, {
    method: 'POST',
    url: `/api/v1/organizations/${organization.body.id}/channels`,
    token,
    body: { reference: `@${username}` },
  });
  const community = await call(harness, {
    method: 'POST',
    url: '/api/v1/communities',
    token,
    body: { channelId: channel.body.channel.id },
  });
  await call(harness, { method: 'POST', url: `/api/v1/communities/${community.body.id}/launch`, token, body: {} });
  return { organizationId: organization.body.id, channelId: channel.body.channel.id, communityId: community.body.id };
}

describe('multi-tenant isolation', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('keeps two creators completely separate', async () => {
    const alice = await signIn(harness, 601_001, 'alice');
    const bob = await signIn(harness, 601_002, 'bob');
    const a = await connectedCommunity(harness, alice.token, 'Alice Media', CHANNEL_A, 'alice_channel');
    const b = await connectedCommunity(harness, bob.token, 'Bob Media', CHANNEL_B, 'bob_channel');

    // Bob cannot even learn that Alice's organization exists.
    expect((await call(harness, { method: 'GET', url: `/api/v1/organizations/${a.organizationId}/overview`, token: bob.token })).status).toBe(404);
    expect((await call(harness, { method: 'GET', url: `/api/v1/communities/${a.communityId}/analytics`, token: bob.token })).status).toBe(404);
    expect(
      (await call(harness, { method: 'GET', url: `/api/v1/communities/${a.communityId}/quizzes`, token: bob.token })).status,
    ).toBe(404);

    const bobOrganizations = await call(harness, { method: 'GET', url: '/api/v1/organizations', token: bob.token });
    expect(bobOrganizations.body).toHaveLength(1);
    expect(bobOrganizations.body[0].id).toBe(b.organizationId);
  });

  it('refuses to connect a channel that already belongs to another organization', async () => {
    const alice = await signIn(harness, 602_001, 'alice2');
    const bob = await signIn(harness, 602_002, 'bob2');
    await connectedCommunity(harness, alice.token, 'Alice Media', CHANNEL_A, 'shared_channel');
    const bobOrganization = await call(harness, { method: 'POST', url: '/api/v1/organizations', token: bob.token, body: { name: 'Bob Media' } });
    const stolen = await call(harness, {
      method: 'POST',
      url: `/api/v1/organizations/${bobOrganization.body.id}/channels`,
      token: bob.token,
      body: { reference: '@shared_channel' },
    });
    expect(stolen.status).toBe(409);
  });

  it('lets one member belong to several communities with one balance', async () => {
    const alice = await signIn(harness, 603_001, 'alice3');
    const bob = await signIn(harness, 603_002, 'bob3');
    const learner = await signIn(harness, 603_100, 'learner');
    const a = await connectedCommunity(harness, alice.token, 'Alice Media', CHANNEL_A, 'alice_ch3');
    const b = await connectedCommunity(harness, bob.token, 'Bob Media', CHANNEL_B, 'bob_ch3');

    joinChannel(harness, 603_100, CHANNEL_A);
    joinChannel(harness, 603_100, CHANNEL_B);
    await call(harness, { method: 'POST', url: `/api/v1/communities/${a.communityId}/membership/sync`, token: learner.token, body: {} });
    await call(harness, { method: 'POST', url: `/api/v1/communities/${b.communityId}/membership/sync`, token: learner.token, body: {} });

    const home = await call(harness, { method: 'GET', url: '/api/v1/me/home', token: learner.token });
    expect(home.body.communities).toHaveLength(2);
    expect(home.body.communitiesJoined).toBe(2);
    expect(home.body.balance.total).toBe('0');
  });

  it('enforces organization roles', async () => {
    const owner = await signIn(harness, 604_001, 'owner');
    const analyst = await signIn(harness, 604_002, 'analyst');
    const a = await connectedCommunity(harness, owner.token, 'Owner Media', CHANNEL_A, 'owner_ch');

    await call(harness, {
      method: 'POST',
      url: `/api/v1/organizations/${a.organizationId}/members`,
      token: owner.token,
      body: { telegramId: 604_002, role: 'ANALYST' },
    });

    const analytics = await call(harness, { method: 'GET', url: `/api/v1/communities/${a.communityId}/analytics`, token: analyst.token });
    expect(analytics.status).toBe(200);

    const forbidden = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${a.communityId}/policies/revenue`,
      token: analyst.token,
      body: { creatorShareBps: 1000 },
    });
    expect(forbidden.status).toBe(403);

    const alsoForbidden = await call(harness, {
      method: 'POST',
      url: `/api/v1/organizations/${a.organizationId}/channels`,
      token: analyst.token,
      body: { reference: '@owner_ch' },
    });
    expect(alsoForbidden.status).toBe(403);
  });

  it('denies platform administration to an ordinary creator', async () => {
    const creator = await signIn(harness, 605_001, 'creator');
    expect((await call(harness, { method: 'GET', url: '/api/v1/admin/overview', token: creator.token })).status).toBe(403);
    expect((await call(harness, { method: 'GET', url: '/api/v1/admin/ledger/health', token: creator.token })).status).toBe(403);
  });
});

describe('membership, referrals and fraud', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('follows a member through join, leave and rejoin', async () => {
    const creator = await signIn(harness, 606_001, 'creator');
    const member = await signIn(harness, 606_100, 'member');
    const community = await connectedCommunity(harness, creator.token, 'Media', CHANNEL_A, 'lifecycle_ch');

    joinChannel(harness, 606_100, CHANNEL_A);
    const joined = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${community.communityId}/membership/sync`,
      token: member.token,
      body: {},
    });
    expect(joined.body.status).toBe('ACTIVE');

    leaveChannel(harness, 606_100, CHANNEL_A);
    const left = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${community.communityId}/membership/sync`,
      token: member.token,
      body: {},
    });
    expect(left.body.status).toBe('LEFT');

    joinChannel(harness, 606_100, CHANNEL_A);
    const rejoined = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${community.communityId}/membership/sync`,
      token: member.token,
      body: {},
    });
    // A rejoin lands in cooldown, so leaving and returning cannot farm the growth pool.
    expect(rejoined.body.status).toBe('REJOIN_COOLDOWN');

    const analytics = await call(harness, {
      method: 'GET',
      url: `/api/v1/communities/${community.communityId}/analytics`,
      token: creator.token,
    });
    expect(analytics.body.joins30d).toBe(1);
    expect(analytics.body.leaves30d).toBe(1);
    expect(analytics.body.rejoins30d).toBe(1);
  });

  it('records a membership change delivered by webhook', async () => {
    const creator = await signIn(harness, 607_001, 'creator');
    const community = await connectedCommunity(harness, creator.token, 'Media', CHANNEL_A, 'webhook_ch');

    const update = await call(harness, {
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      body: {
        update_id: 77,
        chat_member: {
          chat: { id: CHANNEL_A, type: 'channel', title: 'Webhook channel' },
          from: { id: 607_100 },
          date: Math.floor(Date.now() / 1000),
          old_chat_member: { user: { id: 607_100 }, status: 'left' },
          new_chat_member: { user: { id: 607_100, username: 'joiner' }, status: 'member' },
        },
      },
    });
    expect(update.body.detail).toBe('JOIN');

    const members = await harness.prisma.communityMember.count({ where: { communityId: community.communityId, status: 'ACTIVE' } });
    expect(members).toBe(1);
  });

  it('downgrades a channel when the bot loses posting rights', async () => {
    const creator = await signIn(harness, 608_001, 'creator');
    const community = await connectedCommunity(harness, creator.token, 'Media', CHANNEL_A, 'degrade_ch');

    await call(harness, {
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      body: {
        update_id: 88,
        my_chat_member: {
          chat: { id: CHANNEL_A, type: 'channel' },
          from: { id: 608_001 },
          date: Math.floor(Date.now() / 1000),
          old_chat_member: { user: { id: harness.telegram.state.me.id }, status: 'administrator', can_post_messages: true },
          new_chat_member: { user: { id: harness.telegram.state.me.id }, status: 'administrator', can_invite_users: true },
        },
      },
    });

    const channel = await harness.prisma.telegramChannel.findUniqueOrThrow({ where: { id: community.channelId } });
    expect(channel.status).toBe('DEGRADED');
    expect(channel.missingPermissions).toContain('can_post_messages');
  });

  it('attributes a referral at sign-in and qualifies it once the invitee stays', async () => {
    const creator = await signIn(harness, 609_001, 'creator');
    const inviter = await signIn(harness, 609_100, 'inviter');
    const community = await connectedCommunity(harness, creator.token, 'Media', CHANNEL_A, 'referral_ch');

    joinChannel(harness, 609_100, CHANNEL_A);
    await call(harness, { method: 'POST', url: `/api/v1/communities/${community.communityId}/membership/sync`, token: inviter.token, body: {} });

    const referralPage = await call(harness, { method: 'GET', url: '/api/v1/me/referrals', token: inviter.token });
    expect(referralPage.body.communityLinks).toHaveLength(1);
    const startParam = new URL(referralPage.body.communityLinks[0].link).searchParams.get('startapp')!;

    const invitee = await signIn(harness, 609_200, 'invitee', startParam);
    joinChannel(harness, 609_200, CHANNEL_A);
    await call(harness, { method: 'POST', url: `/api/v1/communities/${community.communityId}/membership/sync`, token: invitee.token, body: {} });

    const referrals = await harness.prisma.referral.findMany({ where: { referrerUserId: inviter.user.id } });
    expect(referrals).toHaveLength(1);
    expect(referrals[0]?.status).toBe('PENDING');
    expect(referrals[0]?.communityId).toBe(community.communityId);

    // Five weeks later the invitee is still in the channel, so the referral qualifies.
    harness.setNow(new Date('2026-10-08T12:00:00Z'));
    // The old session has passed its maximum lifetime by now, so sign in again.
    const creatorLater = await signIn(harness, 609_001, 'creator');
    const revenue = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${community.communityId}/revenue`,
      token: creatorLater.token,
      body: {
        source: 'telegram_ads',
        amountNanoton: parseTon('10').toString(),
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-10-07T00:00:00.000Z',
        externalReference: 'ref-cycle-1',
      },
    });
    await call(harness, { method: 'POST', url: `/api/v1/revenue/${revenue.body.id}/status`, token: creatorLater.token, body: { status: 'FUNDED' } });
    const revenueCycle = await call(harness, {
      method: 'POST',
      url: `/api/v1/communities/${community.communityId}/revenue-cycles`,
      token: creatorLater.token,
      body: { periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-07T00:00:00.000Z' },
    });
    expect(revenueCycle.status, JSON.stringify(revenueCycle.body)).toBe(200);
    const rewardCycle = await call(harness, {
      method: 'POST',
      url: `/api/v1/revenue-cycles/${revenueCycle.body.cycle.id}/reward-cycle`,
      token: creatorLater.token,
      body: {},
    });
    await call(harness, { method: 'POST', url: `/api/v1/reward-cycles/${rewardCycle.body.id}/calculate`, token: creatorLater.token, body: {} });

    const qualified = await harness.prisma.referral.findFirstOrThrow({ where: { referrerUserId: inviter.user.id } });
    expect(qualified.status).toBe('QUALIFIED');

    const detail = await call(harness, { method: 'GET', url: `/api/v1/reward-cycles/${rewardCycle.body.id}`, token: creatorLater.token });
    const referralAllocation = detail.body.allocations.find((allocation: any) => allocation.type === 'REFERRAL');
    expect(referralAllocation?.userId).toBe(inviter.user.id);
    expect(referralAllocation?.amountNanoton).toBe(parseTon('1.35').toString());
  });

  it('raises a fraud signal when one wallet is shared by several accounts', async () => {
    const address = '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8';
    for (const telegramId of [610_001, 610_002, 610_003]) {
      const session = await signIn(harness, telegramId, `user${telegramId}`);
      const linked = await call(harness, { method: 'POST', url: '/api/v1/me/wallets', token: session.token, body: { address } });
      expect(linked.status).toBe(200);
    }
    const signals = await harness.prisma.fraudSignal.findMany({ where: { type: 'shared_wallet' } });
    expect(signals).toHaveLength(1);
    expect((signals[0]?.evidence as { distinctUsers: number }).distinctUsers).toBe(3);
  });

  it('rejects an expired session', async () => {
    const session = await signIn(harness, 611_001, 'expiring');
    harness.setNow(new Date('2027-01-01T00:00:00Z'));
    expect((await call(harness, { method: 'GET', url: '/api/v1/me', token: session.token })).status).toBe(401);
  });

  it('rejects a webhook without the configured secret', async () => {
    await harness.close();
    harness = await createHarness({ TELEGRAM_WEBHOOK_SECRET: 'top-secret' });
    const denied = await call(harness, { method: 'POST', url: '/api/v1/telegram/webhook', body: { update_id: 1 } });
    expect(denied.status).toBe(401);

    const allowed = await call(harness, {
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      body: { update_id: 1 },
      headers: { 'x-telegram-bot-api-secret-token': 'top-secret' },
    });
    expect(allowed.status).toBe(200);
  });
});
