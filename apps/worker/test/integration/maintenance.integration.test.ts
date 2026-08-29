import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTon } from '@cle/core';
import {
  createQuizPolicyVersion,
  ensureMember,
  ingestChannelPost,
  linkWallet,
  recordReferral,
  requestUserWithdrawal,
  upsertTelegramUser,
} from '@cle/api';
import { CHANNEL_CHAT_ID, LONG_POST, type WorkerHarness, createWorkerHarness, seedCommunity } from '../harness.js';
import { runMaintenancePass } from '../../src/maintenance.js';

describe('maintenance pass', () => {
  let harness: WorkerHarness;

  beforeEach(async () => {
    harness = await createWorkerHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('does nothing and reports no errors when the platform is empty', async () => {
    const report = await runMaintenancePass(harness.ctx);
    expect(report).toMatchObject({ communities: 0, errors: [] });
  });

  it('generates and publishes a quiz once the configured delay has passed', async () => {
    const seeded = await seedCommunity(harness);
    await createQuizPolicyVersion(harness.ctx, {
      communityId: seeded.community.id,
      enabled: true,
      mode: 'AUTO',
      quizDelayMinutes: 30,
      minimumPostLength: 100,
    });

    await ingestChannelPost(harness.ctx, seeded.community.id, {
      message_id: 1,
      date: Math.floor(new Date('2026-09-01T12:00:00Z').getTime() / 1000),
      chat: { id: CHANNEL_CHAT_ID, type: 'channel', username: 'worker_test' },
      text: LONG_POST,
    });

    // Too early: the delay has not elapsed.
    const early = await runMaintenancePass(harness.ctx);
    expect(early.quizzesGenerated).toBe(0);

    harness.setNow(new Date('2026-09-01T13:00:00Z'));
    const later = await runMaintenancePass(harness.ctx);
    expect(later.quizzesGenerated).toBe(1);
    expect(later.quizzesPublished).toBe(1);
    expect(later.errors).toEqual([]);

    const quiz = await harness.prisma.quiz.findFirstOrThrow({ where: { communityId: seeded.community.id } });
    expect(quiz.status).toBe('PUBLISHED');
    expect(harness.telegram.state.sent.at(-1)?.text).toContain('TEST YOUR KNOWLEDGE');
  });

  it('publishes a quiz a human approved by hand', async () => {
    const seeded = await seedCommunity(harness);
    await createQuizPolicyVersion(harness.ctx, { communityId: seeded.community.id, enabled: true, mode: 'MANUAL', minimumPostLength: 100 });
    const quiz = await harness.prisma.quiz.create({
      data: { communityId: seeded.community.id, title: 'Approved by hand', status: 'APPROVED', totalPoints: 30 },
    });

    const report = await runMaintenancePass(harness.ctx);
    expect(report.quizzesPublished).toBe(1);
    expect((await harness.prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } })).status).toBe('PUBLISHED');
  });

  it('completes a rejoin cooldown once it has elapsed', async () => {
    const seeded = await seedCommunity(harness);
    const user = await upsertTelegramUser(harness.ctx, { id: 700_100n, username: 'rejoiner' });
    // The member really is in the channel, so the scheduled re-sync leaves them alone.
    harness.telegram.setMember(CHANNEL_CHAT_ID, 700_100, { user: { id: 700_100 }, status: 'member' });
    const member = await ensureMember(harness.ctx, seeded.community.id, user.id);
    await harness.prisma.communityMember.update({
      where: { id: member.id },
      data: { status: 'REJOIN_COOLDOWN', rejoinCount: 1, currentJoinAt: new Date('2026-09-01T00:00:00Z') },
    });

    expect((await runMaintenancePass(harness.ctx)).cooldownsCompleted).toBe(0);

    harness.setNow(new Date('2026-09-10T00:00:00Z'));
    expect((await runMaintenancePass(harness.ctx)).cooldownsCompleted).toBe(1);
    const updated = await harness.prisma.communityMember.findUniqueOrThrow({ where: { id: member.id } });
    expect(updated.status).toBe('ACTIVE');
  });

  it('qualifies a referral once the invitee has stayed long enough', async () => {
    const seeded = await seedCommunity(harness);
    const inviter = await upsertTelegramUser(harness.ctx, { id: 700_201n, username: 'inviter' });
    const invitee = await upsertTelegramUser(harness.ctx, { id: 700_202n, username: 'invitee' });
    harness.telegram.setMember(CHANNEL_CHAT_ID, 700_202, { user: { id: 700_202 }, status: 'member' });
    const member = await ensureMember(harness.ctx, seeded.community.id, invitee.id);
    await harness.prisma.communityMember.update({
      where: { id: member.id },
      data: { status: 'ACTIVE', currentJoinAt: new Date('2026-09-01T00:00:00Z'), firstJoinAt: new Date('2026-09-01T00:00:00Z') },
    });
    await recordReferral(harness.ctx, { referrerUserId: inviter.id, referredUserId: invitee.id, communityId: seeded.community.id });

    expect((await runMaintenancePass(harness.ctx)).referralsQualified).toBe(0);

    harness.setNow(new Date('2026-10-05T00:00:00Z'));
    expect((await runMaintenancePass(harness.ctx)).referralsQualified).toBe(1);
    const referral = await harness.prisma.referral.findFirstOrThrow({ where: { referrerUserId: inviter.id } });
    expect(referral.status).toBe('QUALIFIED');
  });

  it('processes a locked withdrawal and settles the ledger', async () => {
    const seeded = await seedCommunity(harness);
    const user = await upsertTelegramUser(harness.ctx, { id: 700_300n, username: 'earner' });
    const actor = { id: user.id, isPlatformAdmin: false };
    await linkWallet(harness.ctx, { userId: user.id, address: '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8' });

    // Credit the member directly through the ledger so the test targets the payout path.
    const account = await harness.prisma.ledgerAccount.create({ data: { type: 'USER_AVAILABLE', ownerId: user.id, label: 'test' } });
    const source = await harness.prisma.ledgerAccount.create({ data: { type: 'REVENUE_SOURCE', ownerId: seeded.community.id, label: 'test' } });
    await harness.prisma.ledgerTransaction.create({
      data: {
        kind: 'ADMIN_ADJUSTMENT',
        reference: 'test-credit',
        entries: {
          create: [
            { accountId: source.id, direction: 'DEBIT', amountNanoton: parseTon('5') },
            { accountId: account.id, direction: 'CREDIT', amountNanoton: parseTon('5') },
          ],
        },
      },
    });

    const withdrawal = await requestUserWithdrawal(harness.ctx, actor, { amountNanoton: parseTon('5') });
    expect(withdrawal.status).toBe('LOCKED');

    const report = await runMaintenancePass(harness.ctx);
    expect(report.withdrawalsProcessed).toBe(1);
    const settled = await harness.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
    expect(settled.status).toBe('CONFIRMED');
    expect(settled.txHash).toMatch(/^mock-/);
    expect(harness.payouts.history).toHaveLength(1);
  });

  it('keeps going when one community fails and reports the error', async () => {
    const seeded = await seedCommunity(harness);
    await createQuizPolicyVersion(harness.ctx, { communityId: seeded.community.id, enabled: true, mode: 'AUTO', minimumPostLength: 100 });
    await ingestChannelPost(harness.ctx, seeded.community.id, {
      message_id: 2,
      date: Math.floor(harness.ctx.now().getTime() / 1000),
      chat: { id: CHANNEL_CHAT_ID, type: 'channel', username: 'worker_test' },
      text: LONG_POST,
    });
    // A post shorter than the policy minimum can never produce a quiz.
    await harness.prisma.contentItem.updateMany({
      where: { communityId: seeded.community.id },
      data: { text: 'too short', status: 'QUIZ_REQUESTED' },
    });

    const report = await runMaintenancePass(harness.ctx);
    expect(report.quizzesGenerated).toBe(0);
    expect(report.errors.join(' ')).toMatch(/character minimum/);
    // The rest of the pass still ran.
    expect(report.communities).toBe(1);
  });
});
