import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, RewardAllocationStatus, RewardAllocationType, RewardCycleStatus, prisma } from '../../src/index.js';

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const runId = randomUUID();
let userId = '';
let cycleId = '';

describeDatabase('PostgreSQL financial constraints', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({ data: { telegramId: BigInt(Date.now()), referralCode: `test-${runId}` } });
    userId = user.id;
    const cycle = await prisma.rewardCycle.create({
      data: {
        periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31'), grossRevenueNanoton: 100n,
        creatorShareNanoton: 10n, communityShareNanoton: 90n, growthPoolNanoton: 31n, loyaltyPoolNanoton: 36n,
        referralPoolNanoton: 14n, sciencePoolNanoton: 9n, configurationSnapshot: {}, status: RewardCycleStatus.DRAFT,
      },
    });
    cycleId = cycle.id;
  });

  afterAll(async () => {
    await prisma.rewardAllocation.deleteMany({ where: { cycleId } });
    await prisma.rewardCycle.deleteMany({ where: { id: cycleId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('enforces a single category allocation per user per cycle', async () => {
    const data = {
      cycleId, userId, type: RewardAllocationType.GROWTH, amountNanoton: 1n,
      idempotencyKey: `test-allocation-${runId}`, status: RewardAllocationStatus.PENDING,
    };
    await prisma.rewardAllocation.create({ data });
    await expect(prisma.rewardAllocation.create({ data: { ...data, idempotencyKey: `duplicate-${runId}` } })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
