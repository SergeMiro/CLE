import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireActor } from '../plugins/auth.js';
import { communityAnalytics, organizationOverview } from '../services/analytics.js';
import { connectChannel, listChannels, setMonetization, verifyChannel } from '../services/channels.js';
import { createCommunity, launchCommunity, listCommunities, setCommunityStatus } from '../services/communities.js';
import { listContent } from '../services/content.js';
import { addOrganizationMember, createOrganization, listOrganizationsForUser } from '../services/organizations.js';
import {
  createQuizPolicyVersion,
  createRevenuePolicyVersion,
  createRewardPolicyVersion,
  currentPlatformPolicy,
  effectiveQuizPolicy,
  effectiveRevenuePolicy,
  effectiveRewardPolicy,
} from '../services/policies.js';
import { approveQuiz, generateQuizForContent, publishQuiz } from '../services/quizzes.js';
import { requireCommunityAccess, requireOrganizationAccess } from '../services/rbac.js';
import { listRevenueCycles, openRevenueCycle, recordRevenue, setRevenueStatus } from '../services/revenue.js';
import { approveCycle, calculateCycle, cancelAllocation, createRewardCycle, finalizeCycle, unlockDueAllocations } from '../services/rewards.js';
import { linkOrganizationWallet } from '../services/wallets.js';
import { requestOrganizationWithdrawal } from '../services/withdrawals.js';

const uuidParam = (key: string) => z.object({ [key]: z.uuid() } as Record<string, z.ZodType<string>>);
const nanoton = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((value) => BigInt(value));
const bps = z.number().int().min(0).max(10_000);

export function registerCreatorRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/organizations', async (request) => listOrganizationsForUser(ctx, requireActor(request)));

  app.post('/api/v1/organizations', async (request) => {
    const actor = requireActor(request);
    const body = z.object({ name: z.string().min(2).max(120), slug: z.string().max(40).optional() }).parse(request.body);
    return createOrganization(ctx, actor, body);
  });

  app.get('/api/v1/organizations/:organizationId/overview', async (request) => {
    const { organizationId } = uuidParam('organizationId').parse(request.params) as { organizationId: string };
    return organizationOverview(ctx, requireActor(request), organizationId);
  });

  app.post('/api/v1/organizations/:organizationId/members', async (request) => {
    const { organizationId } = uuidParam('organizationId').parse(request.params) as { organizationId: string };
    const body = z
      .object({ telegramId: z.union([z.string().regex(/^\d+$/), z.number().int()]), role: z.enum(['ADMIN', 'EDITOR', 'ANALYST', 'FINANCE']) })
      .parse(request.body);
    return addOrganizationMember(ctx, requireActor(request), organizationId, { telegramId: BigInt(body.telegramId), role: body.role });
  });

  app.post('/api/v1/organizations/:organizationId/wallet', async (request) => {
    const { organizationId } = uuidParam('organizationId').parse(request.params) as { organizationId: string };
    const body = z.object({ address: z.string().min(10).max(80) }).parse(request.body);
    await requireOrganizationAccess(ctx, requireActor(request), organizationId, 'withdrawal:request');
    return linkOrganizationWallet(ctx, organizationId, body.address);
  });

  app.post('/api/v1/organizations/:organizationId/withdrawals', async (request) => {
    const { organizationId } = uuidParam('organizationId').parse(request.params) as { organizationId: string };
    const body = z.object({ amountNanoton: nanoton, walletId: z.uuid().optional() }).parse(request.body);
    return requestOrganizationWithdrawal(ctx, requireActor(request), organizationId, {
      amountNanoton: body.amountNanoton,
      ...(body.walletId ? { walletId: body.walletId } : {}),
    });
  });

  // --- channels -----------------------------------------------------------
  app.get('/api/v1/organizations/:organizationId/channels', async (request) => {
    const { organizationId } = uuidParam('organizationId').parse(request.params) as { organizationId: string };
    return listChannels(ctx, requireActor(request), organizationId);
  });

  app.post('/api/v1/organizations/:organizationId/channels', async (request) => {
    const { organizationId } = uuidParam('organizationId').parse(request.params) as { organizationId: string };
    const body = z.object({ reference: z.string().min(2).max(120) }).parse(request.body);
    const result = await connectChannel(ctx, requireActor(request), organizationId, body);
    return {
      channel: result.channel,
      status: result.status,
      botIsAdmin: result.botIsAdmin,
      missingRequired: result.missingRequired,
      missingRecommended: result.missingRecommended,
      memberCount: result.memberCount ?? null,
    };
  });

  app.post('/api/v1/channels/:channelId/verify', async (request) => {
    const { channelId } = uuidParam('channelId').parse(request.params) as { channelId: string };
    const result = await verifyChannel(ctx, requireActor(request), channelId);
    return { status: result.status, botIsAdmin: result.botIsAdmin, missingRequired: result.missingRequired };
  });

  app.post('/api/v1/channels/:channelId/monetization', async (request) => {
    const { channelId } = uuidParam('channelId').parse(request.params) as { channelId: string };
    const body = z.object({ status: z.enum(['DISABLED', 'ENABLED', 'PAUSED']) }).parse(request.body);
    return setMonetization(ctx, requireActor(request), channelId, body.status);
  });

  // --- communities --------------------------------------------------------
  app.get('/api/v1/organizations/:organizationId/communities', async (request) => {
    const { organizationId } = uuidParam('organizationId').parse(request.params) as { organizationId: string };
    return listCommunities(ctx, requireActor(request), organizationId);
  });

  app.post('/api/v1/communities', async (request) => {
    const body = z
      .object({
        channelId: z.uuid(),
        name: z.string().min(2).max(120).optional(),
        slug: z.string().max(40).optional(),
        description: z.string().max(500).optional(),
        language: z.string().min(2).max(10).optional(),
        creatorShareBps: bps.optional(),
      })
      .parse(request.body);
    return createCommunity(ctx, requireActor(request), body);
  });

  app.post('/api/v1/communities/:communityId/launch', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    return launchCommunity(ctx, requireActor(request), communityId);
  });

  app.post('/api/v1/communities/:communityId/status', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    const body = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']) }).parse(request.body);
    return setCommunityStatus(ctx, requireActor(request), communityId, body.status);
  });

  app.get('/api/v1/communities/:communityId/analytics', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    return communityAnalytics(ctx, requireActor(request), communityId);
  });

  // --- policies -----------------------------------------------------------
  app.get('/api/v1/communities/:communityId/policies', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    await requireCommunityAccess(ctx, requireActor(request), communityId, 'analytics:read');
    const [platform, revenue, reward, quiz] = await Promise.all([
      currentPlatformPolicy(ctx),
      effectiveRevenuePolicy(ctx, communityId),
      effectiveRewardPolicy(ctx, communityId),
      effectiveQuizPolicy(ctx, communityId),
    ]);
    return { platform, revenue, reward, quiz };
  });

  app.post('/api/v1/communities/:communityId/policies/revenue', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    const actor = requireActor(request);
    await requireCommunityAccess(ctx, actor, communityId, 'revenue:manage');
    const body = z.object({ creatorShareBps: bps }).parse(request.body);
    return createRevenuePolicyVersion(ctx, { communityId, creatorShareBps: body.creatorShareBps, createdByUserId: actor.id });
  });

  app.post('/api/v1/communities/:communityId/policies/reward', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    const actor = requireActor(request);
    await requireCommunityAccess(ctx, actor, communityId, 'community:configure');
    const body = z
      .object({
        growthBps: bps,
        loyaltyBps: bps,
        referralBps: bps,
        learningBps: bps,
        newMemberHoldDays: z.number().int().min(0).max(365).optional(),
        rejoinCooldownDays: z.number().int().min(0).max(365).optional(),
        referralQualificationDays: z.number().int().min(0).max(365).optional(),
        minRewardNanoton: nanoton.optional(),
      })
      .parse(request.body);
    return createRewardPolicyVersion(ctx, { communityId, ...body, createdByUserId: actor.id });
  });

  app.post('/api/v1/communities/:communityId/policies/quiz', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    await requireCommunityAccess(ctx, requireActor(request), communityId, 'quiz:manage');
    const body = z
      .object({
        enabled: z.boolean().optional(),
        mode: z.enum(['MANUAL', 'AUTO']).optional(),
        questionsPerQuiz: z.number().int().min(1).max(10).optional(),
        difficulty: z.enum(['EASY', 'NORMAL', 'HARD', 'CHALLENGE']).optional(),
        language: z.string().min(2).max(10).optional(),
        quizDelayMinutes: z.number().int().min(0).max(1440).optional(),
        dailyQuizLimit: z.number().int().min(1).max(20).optional(),
        categoriesAllowed: z.array(z.string().max(30)).max(20).optional(),
        minimumPostLength: z.number().int().min(0).max(5000).optional(),
        publishButtonText: z.string().min(1).max(40).optional(),
        rewardEnabled: z.boolean().optional(),
        qualityThreshold: z.number().int().min(0).max(100).optional(),
        pointsPerQuestion: z.number().int().min(1).max(100).optional(),
      })
      .parse(request.body);
    return createQuizPolicyVersion(ctx, { communityId, ...body });
  });

  // --- content and quizzes ------------------------------------------------
  app.get('/api/v1/communities/:communityId/content', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    await requireCommunityAccess(ctx, requireActor(request), communityId, 'content:manage');
    return listContent(ctx, communityId);
  });

  app.get('/api/v1/communities/:communityId/quizzes', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    await requireCommunityAccess(ctx, requireActor(request), communityId, 'quiz:manage');
    return ctx.prisma.quiz.findMany({
      where: { communityId },
      include: { _count: { select: { questions: true, attempts: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  app.post('/api/v1/content/:contentItemId/quiz', async (request) => {
    const { contentItemId } = uuidParam('contentItemId').parse(request.params) as { contentItemId: string };
    const content = await ctx.prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId }, select: { communityId: true } });
    await requireCommunityAccess(ctx, requireActor(request), content.communityId, 'quiz:manage');
    const result = await generateQuizForContent(ctx, contentItemId);
    return { quizId: result.quiz.id, status: result.quiz.status, qualityScore: result.qualityScore, issues: result.issues };
  });

  app.post('/api/v1/quizzes/:quizId/approve', async (request) => {
    const { quizId } = uuidParam('quizId').parse(request.params) as { quizId: string };
    return approveQuiz(ctx, requireActor(request), quizId);
  });

  app.post('/api/v1/quizzes/:quizId/publish', async (request) => {
    const { quizId } = uuidParam('quizId').parse(request.params) as { quizId: string };
    const result = await publishQuiz(ctx, quizId, requireActor(request));
    return { quizId: result.quiz.id, status: result.quiz.status, messageId: result.messageId ?? null, link: result.link };
  });

  // --- revenue and rewards ------------------------------------------------
  app.post('/api/v1/communities/:communityId/revenue', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    const body = z
      .object({
        source: z.string().min(2).max(60),
        amountNanoton: nanoton,
        periodStart: z.iso.datetime(),
        periodEnd: z.iso.datetime(),
        externalReference: z.string().min(3).max(120),
      })
      .parse(request.body);
    return recordRevenue(ctx, requireActor(request), {
      communityId,
      source: body.source,
      amountNanoton: body.amountNanoton,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      externalReference: body.externalReference,
    });
  });

  app.post('/api/v1/revenue/:entryId/status', async (request) => {
    const { entryId } = uuidParam('entryId').parse(request.params) as { entryId: string };
    const body = z.object({ status: z.enum(['CONFIRMED', 'FUNDED', 'CANCELLED']) }).parse(request.body);
    return setRevenueStatus(ctx, requireActor(request), entryId, body.status);
  });

  app.get('/api/v1/communities/:communityId/revenue-cycles', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    return listRevenueCycles(ctx, requireActor(request), communityId);
  });

  app.post('/api/v1/communities/:communityId/revenue-cycles', async (request) => {
    const { communityId } = uuidParam('communityId').parse(request.params) as { communityId: string };
    const body = z.object({ periodStart: z.iso.datetime(), periodEnd: z.iso.datetime() }).parse(request.body);
    const result = await openRevenueCycle(ctx, requireActor(request), {
      communityId,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
    });
    return { cycle: result.cycle, entryCount: result.entryCount };
  });

  app.post('/api/v1/revenue-cycles/:revenueCycleId/reward-cycle', async (request) => {
    const { revenueCycleId } = uuidParam('revenueCycleId').parse(request.params) as { revenueCycleId: string };
    return createRewardCycle(ctx, requireActor(request), revenueCycleId);
  });

  app.post('/api/v1/reward-cycles/:cycleId/calculate', async (request) => {
    const { cycleId } = uuidParam('cycleId').parse(request.params) as { cycleId: string };
    return calculateCycle(ctx, requireActor(request), cycleId);
  });

  app.post('/api/v1/reward-cycles/:cycleId/approve', async (request) => {
    const { cycleId } = uuidParam('cycleId').parse(request.params) as { cycleId: string };
    return approveCycle(ctx, requireActor(request), cycleId);
  });

  app.post('/api/v1/reward-cycles/:cycleId/finalize', async (request) => {
    const { cycleId } = uuidParam('cycleId').parse(request.params) as { cycleId: string };
    const cycle = await finalizeCycle(ctx, requireActor(request), cycleId);
    const unlocked = await unlockDueAllocations(ctx, cycle.communityId);
    return { cycle, unlockedAllocations: unlocked };
  });

  app.get('/api/v1/reward-cycles/:cycleId', async (request) => {
    const { cycleId } = uuidParam('cycleId').parse(request.params) as { cycleId: string };
    const cycle = await ctx.prisma.rewardCycle.findUniqueOrThrow({ where: { id: cycleId } });
    await requireCommunityAccess(ctx, requireActor(request), cycle.communityId, 'analytics:read');
    const [pools, allocations, snapshots] = await Promise.all([
      ctx.prisma.rewardPool.findMany({ where: { cycleId } }),
      ctx.prisma.rewardAllocation.findMany({
        where: { cycleId },
        include: { user: { select: { telegramUsername: true, telegramFirstName: true } } },
        orderBy: { amountNanoton: 'desc' },
        take: 200,
      }),
      ctx.prisma.rewardEligibilitySnapshot.count({ where: { cycleId } }),
    ]);
    return { cycle, pools, allocations, snapshotCount: snapshots };
  });

  app.post('/api/v1/reward-allocations/:allocationId/cancel', async (request) => {
    const { allocationId } = uuidParam('allocationId').parse(request.params) as { allocationId: string };
    const body = z.object({ reason: z.string().min(3).max(200) }).parse(request.body);
    await cancelAllocation(ctx, requireActor(request), allocationId, body.reason);
    return { ok: true };
  });
}
