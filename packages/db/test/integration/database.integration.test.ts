import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '../../src/index.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://cle:cle@localhost:5432/cle_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const run = randomUUID().slice(0, 8);
let userId = '';
let organizationId = '';
let communityId = '';
let channelId = '';
let revenueCycleId = '';
let rewardCycleId = '';

/** The database is the last line of defence; these tests exercise it directly. */
describe('PostgreSQL constraints', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()), referralCode: `C${run}` } });
    userId = user.id;
    const organization = await prisma.organization.create({ data: { name: `Org ${run}`, slug: `org-${run}`, ownerUserId: user.id } });
    organizationId = organization.id;
    const channel = await prisma.telegramChannel.create({
      data: { organizationId, telegramChatId: BigInt(-1_000_000 - Date.now() % 1_000_000), title: `Channel ${run}`, missingPermissions: [] },
    });
    channelId = channel.id;
    const community = await prisma.community.create({
      data: { organizationId, channelId, slug: `community-${run}`, name: `Community ${run}` },
    });
    communityId = community.id;
    const revenueCycle = await prisma.revenueCycle.create({
      data: {
        communityId,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        grossNanoton: 100n,
        platformFeeNanoton: 10n,
        creatorShareNanoton: 5n,
        communityShareNanoton: 85n,
        platformFeeBps: 1000,
        creatorShareBps: 500,
        policySnapshot: {},
      },
    });
    revenueCycleId = revenueCycle.id;
    const rewardCycle = await prisma.rewardCycle.create({
      data: {
        communityId,
        revenueCycleId,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        distributableNanoton: 85n,
        policySnapshot: {},
      },
    });
    rewardCycleId = rewardCycle.id;
  });

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { account: { ownerId: userId } } });
    await prisma.ledgerTransaction.deleteMany({ where: { reference: { startsWith: `ref-${run}` } } });
    await prisma.ledgerAccount.deleteMany({ where: { ownerId: { in: [userId, communityId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('allows one allocation per member per pool per cycle', async () => {
    const data = {
      cycleId: rewardCycleId,
      communityId,
      userId,
      type: 'GROWTH' as const,
      amountNanoton: 1n,
      idempotencyKey: `alloc-${run}`,
      status: 'PENDING' as const,
    };
    await prisma.rewardAllocation.create({ data });
    await expect(prisma.rewardAllocation.create({ data: { ...data, idempotencyKey: `alloc-dup-${run}` } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('rejects a duplicate ledger transaction reference', async () => {
    await prisma.ledgerTransaction.create({ data: { kind: 'REVENUE_SPLIT', reference: `ref-${run}-1` } });
    await expect(prisma.ledgerTransaction.create({ data: { kind: 'REVENUE_SPLIT', reference: `ref-${run}-1` } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('rejects a second ledger account of the same type for one owner', async () => {
    await prisma.ledgerAccount.create({ data: { type: 'USER_AVAILABLE', ownerId: userId, label: 'test' } });
    await expect(prisma.ledgerAccount.create({ data: { type: 'USER_AVAILABLE', ownerId: userId, label: 'again' } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('stores one membership per person per community', async () => {
    await prisma.communityMember.create({ data: { communityId, userId } });
    await expect(prisma.communityMember.create({ data: { communityId, userId } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('ingests one content item per Telegram message', async () => {
    const data = { communityId, channelId, telegramMessageId: 4242n, text: 'post', topics: [], publishedAt: new Date() };
    await prisma.contentItem.create({ data });
    await expect(prisma.contentItem.create({ data })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('records one referral per person per community, and one at platform level', async () => {
    const invited = await prisma.user.create({ data: { telegramId: BigInt(Date.now() + 1), referralCode: `D${run}` } });
    const data = {
      scope: 'COMMUNITY' as const,
      communityId,
      communityKey: communityId,
      referrerUserId: userId,
      referredUserId: invited.id,
    };
    await prisma.referral.create({ data });
    await expect(prisma.referral.create({ data })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    // The platform-scope row has no communityId; the literal key keeps it unique anyway.
    const platform = { scope: 'PLATFORM' as const, communityKey: 'platform', referrerUserId: userId, referredUserId: invited.id };
    await prisma.referral.create({ data: platform });
    await expect(prisma.referral.create({ data: platform })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    await prisma.referral.deleteMany({ where: { referredUserId: invited.id } });
    await prisma.user.delete({ where: { id: invited.id } });
  });

  it('refuses to delete a user who has a withdrawal on record', async () => {
    const wallet = await prisma.wallet.create({
      data: {
        ownerType: 'USER',
        userId,
        addressRaw: `0:${'ab'.repeat(32)}`,
        addressFriendly: `friendly-${run}`,
        network: 'TESTNET',
      },
    });
    await prisma.withdrawal.create({
      data: { subjectType: 'USER', userId, walletId: wallet.id, amountNanoton: 1n, idempotencyKey: `w-${run}` },
    });
    await expect(prisma.user.delete({ where: { id: userId } })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    await prisma.withdrawal.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
  });

  it('keeps one community per channel', async () => {
    await expect(
      prisma.community.create({ data: { organizationId, channelId, slug: `second-${run}`, name: 'Second' } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
