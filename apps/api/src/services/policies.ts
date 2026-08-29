import { bootstrapPlatformPolicy } from '@cle/config';
import { DEFAULT_LOYALTY_TIERS, type LoyaltyTier, assertCreatorShareAllowed, assertPoolShares } from '@cle/core';
import type { PlatformPolicy, Prisma, QuizGenerationPolicy, RevenuePolicy, RewardPolicy } from '@cle/db';
import type { AppContext } from '../context.js';
import { badRequest, notFound } from '../errors.js';

/**
 * Configuration is a hierarchy: platform policy bounds organization and
 * community policy. Every policy is versioned, and a new version only ever
 * applies to future cycles — history is never rewritten.
 */
export async function currentPlatformPolicy(ctx: AppContext): Promise<PlatformPolicy> {
  const existing = await ctx.prisma.platformPolicy.findFirst({
    where: { effectiveAt: { lte: ctx.now() } },
    orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }],
  });
  if (existing) return existing;
  const bootstrap = bootstrapPlatformPolicy(ctx.env);
  return ctx.prisma.platformPolicy.create({
    data: {
      version: 1,
      platformFeeBps: bootstrap.platformFeeBps,
      maxCreatorShareBps: bootstrap.maxCreatorShareBps,
      minWithdrawalNanoton: bootstrap.minWithdrawalNanoton,
      maxQuizzesPerDay: bootstrap.maxQuizzesPerDay,
      allowedPoolTypes: [...bootstrap.allowedPoolTypes],
      settings: bootstrap as unknown as Prisma.InputJsonValue,
      effectiveAt: new Date(0),
    },
  });
}

export async function effectiveRevenuePolicy(ctx: AppContext, communityId: string, at: Date = ctx.now()): Promise<RevenuePolicy> {
  const policy = await ctx.prisma.revenuePolicy.findFirst({
    where: { communityId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  if (!policy) throw notFound('this community has no revenue policy yet');
  return policy;
}

export async function effectiveRewardPolicy(ctx: AppContext, communityId: string, at: Date = ctx.now()): Promise<RewardPolicy> {
  const policy = await ctx.prisma.rewardPolicy.findFirst({
    where: { communityId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  if (!policy) throw notFound('this community has no reward policy yet');
  return policy;
}

export async function effectiveQuizPolicy(ctx: AppContext, communityId: string, at: Date = ctx.now()): Promise<QuizGenerationPolicy> {
  const policy = await ctx.prisma.quizGenerationPolicy.findFirst({
    where: { communityId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  if (!policy) throw notFound('this community has no quiz policy yet');
  return policy;
}

async function nextVersion(current: number | undefined): Promise<number> {
  return (current ?? 0) + 1;
}

export async function createRevenuePolicyVersion(
  ctx: AppContext,
  input: { communityId: string; creatorShareBps: number; createdByUserId?: string | undefined; effectiveFrom?: Date | undefined },
): Promise<RevenuePolicy> {
  const platform = await currentPlatformPolicy(ctx);
  assertCreatorShareAllowed(input.creatorShareBps, {
    platformFeeBps: platform.platformFeeBps,
    maxCreatorShareBps: platform.maxCreatorShareBps,
  });
  const latest = await ctx.prisma.revenuePolicy.findFirst({ where: { communityId: input.communityId }, orderBy: { version: 'desc' } });
  return ctx.prisma.revenuePolicy.create({
    data: {
      communityId: input.communityId,
      version: await nextVersion(latest?.version),
      creatorShareBps: input.creatorShareBps,
      effectiveFrom: input.effectiveFrom ?? ctx.now(),
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

export interface RewardPolicyInputDto {
  communityId: string;
  growthBps: number;
  loyaltyBps: number;
  referralBps: number;
  learningBps: number;
  newMemberHoldDays?: number | undefined;
  rejoinCooldownDays?: number | undefined;
  referralQualificationDays?: number | undefined;
  loyaltyTiers?: LoyaltyTier[] | undefined;
  minRewardNanoton?: bigint | undefined;
  createdByUserId?: string | undefined;
  effectiveFrom?: Date | undefined;
}

export async function createRewardPolicyVersion(ctx: AppContext, input: RewardPolicyInputDto): Promise<RewardPolicy> {
  assertPoolShares(input);
  const platform = await currentPlatformPolicy(ctx);
  const tiers = input.loyaltyTiers ?? [...DEFAULT_LOYALTY_TIERS];
  if (tiers.length === 0) throw badRequest('at least one loyalty tier is required');
  for (const type of ['GROWTH', 'LOYALTY', 'REFERRAL', 'LEARNING']) {
    if (!platform.allowedPoolTypes.includes(type)) throw badRequest(`reward pool ${type} is not enabled on this platform`);
  }
  const latest = await ctx.prisma.rewardPolicy.findFirst({ where: { communityId: input.communityId }, orderBy: { version: 'desc' } });
  return ctx.prisma.rewardPolicy.create({
    data: {
      communityId: input.communityId,
      version: await nextVersion(latest?.version),
      growthBps: input.growthBps,
      loyaltyBps: input.loyaltyBps,
      referralBps: input.referralBps,
      learningBps: input.learningBps,
      newMemberHoldDays: input.newMemberHoldDays ?? ctx.env.NEW_MEMBER_HOLD_DAYS,
      rejoinCooldownDays: input.rejoinCooldownDays ?? ctx.env.REJOIN_COOLDOWN_DAYS,
      referralQualificationDays: input.referralQualificationDays ?? ctx.env.REFERRAL_QUALIFICATION_DAYS,
      loyaltyTiers: tiers as unknown as Prisma.InputJsonValue,
      learningMultipliers: { streakStepBps: 500, streakCapBps: 15_000 } as unknown as Prisma.InputJsonValue,
      minRewardNanoton: input.minRewardNanoton ?? 0n,
      effectiveFrom: input.effectiveFrom ?? ctx.now(),
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

export interface QuizPolicyInputDto {
  communityId: string;
  enabled?: boolean | undefined;
  mode?: 'MANUAL' | 'AUTO' | undefined;
  questionsPerQuiz?: number | undefined;
  difficulty?: 'EASY' | 'NORMAL' | 'HARD' | 'CHALLENGE' | undefined;
  language?: string | undefined;
  quizDelayMinutes?: number | undefined;
  dailyQuizLimit?: number | undefined;
  categoriesAllowed?: string[] | undefined;
  minimumPostLength?: number | undefined;
  publishButtonText?: string | undefined;
  rewardEnabled?: boolean | undefined;
  qualityThreshold?: number | undefined;
  pointsPerQuestion?: number | undefined;
  effectiveFrom?: Date | undefined;
}

export async function createQuizPolicyVersion(ctx: AppContext, input: QuizPolicyInputDto): Promise<QuizGenerationPolicy> {
  const platform = await currentPlatformPolicy(ctx);
  const dailyQuizLimit = input.dailyQuizLimit ?? platform.maxQuizzesPerDay;
  if (dailyQuizLimit > platform.maxQuizzesPerDay) {
    throw badRequest(`the platform allows at most ${platform.maxQuizzesPerDay} quizzes per day`);
  }
  const latest = await ctx.prisma.quizGenerationPolicy.findFirst({ where: { communityId: input.communityId }, orderBy: { version: 'desc' } });
  return ctx.prisma.quizGenerationPolicy.create({
    data: {
      communityId: input.communityId,
      version: await nextVersion(latest?.version),
      enabled: input.enabled ?? false,
      mode: input.mode ?? 'MANUAL',
      questionsPerQuiz: input.questionsPerQuiz ?? 3,
      difficulty: input.difficulty ?? 'NORMAL',
      language: input.language ?? 'en',
      quizDelayMinutes: input.quizDelayMinutes ?? 0,
      dailyQuizLimit,
      categoriesAllowed: input.categoriesAllowed ?? [],
      minimumPostLength: input.minimumPostLength ?? 200,
      publishButtonText: input.publishButtonText ?? 'START QUIZ',
      rewardEnabled: input.rewardEnabled ?? true,
      qualityThreshold: input.qualityThreshold ?? ctx.env.AI_QUALITY_THRESHOLD,
      pointsPerQuestion: input.pointsPerQuestion ?? 10,
      effectiveFrom: input.effectiveFrom ?? ctx.now(),
    },
  });
}

export function loyaltyTiersOf(policy: RewardPolicy): LoyaltyTier[] {
  const raw = policy.loyaltyTiers as unknown;
  return Array.isArray(raw) && raw.length > 0 ? (raw as LoyaltyTier[]) : [...DEFAULT_LOYALTY_TIERS];
}
