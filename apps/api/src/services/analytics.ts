import type { AppContext } from '../context.js';
import { communityTreasuryBalance, organizationBalances, platformTreasuryBalance, userBalances } from './ledger.js';
import { type Actor, requireCommunityAccess, requireOrganizationAccess, requirePlatformAdmin } from './rbac.js';

export interface CommunityBreakdown {
  communityId: string;
  communityName: string;
  communitySlug: string;
  availableNanoton: bigint;
  pendingNanoton: bigint;
  learningPoints: number;
  level: string | null;
  status: string;
}

export interface UserHome {
  balance: { available: bigint; pending: bigint; locked: bigint; total: bigint };
  communities: CommunityBreakdown[];
  learningPoints: number;
  quizzesCompleted: number;
  communitiesJoined: number;
  openQuizzes: number;
}

/** The member's global view: one balance, broken down by the community it came from. */
export async function userHome(ctx: AppContext, userId: string): Promise<UserHome> {
  const balance = await userBalances(ctx.prisma, userId);
  const memberships = await ctx.prisma.communityMember.findMany({
    where: { userId },
    include: { community: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const allocations = await ctx.prisma.rewardAllocation.groupBy({
    by: ['communityId', 'status'],
    where: { userId, status: { in: ['AVAILABLE', 'PENDING', 'PAID'] } },
    _sum: { amountNanoton: true },
  });

  const communities: CommunityBreakdown[] = memberships.map((membership) => {
    const rows = allocations.filter((row) => row.communityId === membership.communityId);
    const sum = (status: string): bigint => rows.find((row) => row.status === status)?._sum.amountNanoton ?? 0n;
    return {
      communityId: membership.communityId,
      communityName: membership.community.name,
      communitySlug: membership.community.slug,
      availableNanoton: sum('AVAILABLE'),
      pendingNanoton: sum('PENDING'),
      learningPoints: membership.learningPoints,
      level: membership.loyaltyLevelKey,
      status: membership.status,
    };
  });

  const activeCommunityIds = memberships
    .filter((membership) => membership.status === 'ACTIVE' || membership.status === 'REJOIN_COOLDOWN')
    .map((membership) => membership.communityId);
  const openQuizzes =
    activeCommunityIds.length === 0
      ? 0
      : await ctx.prisma.quiz.count({
          where: {
            communityId: { in: activeCommunityIds },
            status: 'PUBLISHED',
            attempts: { none: { userId, status: 'SUBMITTED' } },
          },
        });

  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { learningPoints: true } });
  const quizzesCompleted = await ctx.prisma.quizAttempt.count({ where: { userId, status: 'SUBMITTED' } });

  return {
    balance,
    communities,
    learningPoints: user.learningPoints,
    quizzesCompleted,
    communitiesJoined: memberships.filter((membership) => membership.status === 'ACTIVE').length,
    openQuizzes,
  };
}

export interface CommunityAnalytics {
  members: number;
  activeMembers: number;
  joins30d: number;
  leaves30d: number;
  rejoins30d: number;
  retentionPercent: number;
  quizzesPublished: number;
  quizAttempts: number;
  quizCompletionPercent: number;
  learningPoints: number;
  qualifiedReferrals: number;
  treasuryNanoton: bigint;
  distributedNanoton: bigint;
  rewardPerActiveMemberNanoton: bigint;
  revenuePerActiveMemberNanoton: bigint;
}

export async function communityAnalytics(ctx: AppContext, actor: Actor, communityId: string): Promise<CommunityAnalytics> {
  await requireCommunityAccess(ctx, actor, communityId, 'analytics:read');
  const since = new Date(ctx.now().getTime() - 30 * 86_400_000);

  const [members, activeMembers, events, quizzesPublished, attempts, points, referrals, allocations, revenue] = await Promise.all([
    ctx.prisma.communityMember.count({ where: { communityId } }),
    ctx.prisma.communityMember.count({ where: { communityId, status: 'ACTIVE' } }),
    ctx.prisma.membershipEvent.groupBy({
      by: ['type'],
      where: { member: { communityId }, occurredAt: { gte: since } },
      _count: { _all: true },
    }),
    ctx.prisma.quiz.count({ where: { communityId, status: 'PUBLISHED' } }),
    ctx.prisma.quizAttempt.count({ where: { communityId, status: 'SUBMITTED' } }),
    ctx.prisma.communityMember.aggregate({ where: { communityId }, _sum: { learningPoints: true } }),
    ctx.prisma.referral.count({ where: { communityId, status: { in: ['QUALIFIED', 'REWARDED'] } } }),
    ctx.prisma.rewardAllocation.aggregate({ where: { communityId }, _sum: { amountNanoton: true } }),
    ctx.prisma.revenueCycle.aggregate({ where: { communityId }, _sum: { grossNanoton: true } }),
  ]);

  const countOf = (type: string): number => events.find((event) => event.type === type)?._count._all ?? 0;
  const joins = countOf('JOIN');
  const leaves = countOf('LEAVE');
  const distributed = allocations._sum.amountNanoton ?? 0n;
  const grossRevenue = revenue._sum.grossNanoton ?? 0n;
  const activeDivisor = BigInt(Math.max(1, activeMembers));

  return {
    members,
    activeMembers,
    joins30d: joins,
    leaves30d: leaves,
    rejoins30d: countOf('REJOIN'),
    retentionPercent: members === 0 ? 0 : Math.round((activeMembers / members) * 100),
    quizzesPublished,
    quizAttempts: attempts,
    quizCompletionPercent: quizzesPublished === 0 || activeMembers === 0 ? 0 : Math.min(100, Math.round((attempts / (quizzesPublished * activeMembers)) * 100)),
    learningPoints: points._sum.learningPoints ?? 0,
    qualifiedReferrals: referrals,
    treasuryNanoton: await communityTreasuryBalance(ctx.prisma, communityId),
    distributedNanoton: distributed,
    rewardPerActiveMemberNanoton: distributed / activeDivisor,
    revenuePerActiveMemberNanoton: grossRevenue / activeDivisor,
  };
}

export interface OrganizationOverview {
  organizationId: string;
  channels: number;
  communities: number;
  members: number;
  grossRevenueNanoton: bigint;
  platformFeeNanoton: bigint;
  creatorEarnedNanoton: bigint;
  communityShareNanoton: bigint;
  creatorAvailableNanoton: bigint;
  creatorLockedNanoton: bigint;
  quizzesPublished: number;
  learningPoints: number;
}

export async function organizationOverview(ctx: AppContext, actor: Actor, organizationId: string): Promise<OrganizationOverview> {
  await requireOrganizationAccess(ctx, actor, organizationId, 'analytics:read');
  const communities = await ctx.prisma.community.findMany({ where: { organizationId }, select: { id: true } });
  const communityIds = communities.map((community) => community.id);

  const [channels, members, cycles, quizzes, points, balances] = await Promise.all([
    ctx.prisma.telegramChannel.count({ where: { organizationId } }),
    ctx.prisma.communityMember.count({ where: { communityId: { in: communityIds } } }),
    ctx.prisma.revenueCycle.aggregate({
      where: { communityId: { in: communityIds } },
      _sum: { grossNanoton: true, platformFeeNanoton: true, creatorShareNanoton: true, communityShareNanoton: true },
    }),
    ctx.prisma.quiz.count({ where: { communityId: { in: communityIds }, status: 'PUBLISHED' } }),
    ctx.prisma.communityMember.aggregate({ where: { communityId: { in: communityIds } }, _sum: { learningPoints: true } }),
    organizationBalances(ctx.prisma, organizationId),
  ]);

  return {
    organizationId,
    channels,
    communities: communityIds.length,
    members,
    grossRevenueNanoton: cycles._sum.grossNanoton ?? 0n,
    platformFeeNanoton: cycles._sum.platformFeeNanoton ?? 0n,
    creatorEarnedNanoton: cycles._sum.creatorShareNanoton ?? 0n,
    communityShareNanoton: cycles._sum.communityShareNanoton ?? 0n,
    creatorAvailableNanoton: balances.available,
    creatorLockedNanoton: balances.locked,
    quizzesPublished: quizzes,
    learningPoints: points._sum.learningPoints ?? 0,
  };
}

export interface PlatformOverview {
  organizations: number;
  channels: number;
  communities: number;
  users: number;
  members: number;
  grossRevenueNanoton: bigint;
  platformFeeNanoton: bigint;
  creatorShareNanoton: bigint;
  communityShareNanoton: bigint;
  platformTreasuryNanoton: bigint;
  withdrawalsConfirmedNanoton: bigint;
  quizzesPublished: number;
  quizAttempts: number;
  aiCostMicroUsd: number;
  openFraudCases: number;
}

export async function platformOverview(ctx: AppContext, actor: Actor): Promise<PlatformOverview> {
  requirePlatformAdmin(actor);
  const [organizations, channels, communities, users, members, cycles, withdrawals, quizzes, attempts, ai, fraud, treasury] =
    await Promise.all([
      ctx.prisma.organization.count(),
      ctx.prisma.telegramChannel.count(),
      ctx.prisma.community.count(),
      ctx.prisma.user.count(),
      ctx.prisma.communityMember.count(),
      ctx.prisma.revenueCycle.aggregate({
        _sum: { grossNanoton: true, platformFeeNanoton: true, creatorShareNanoton: true, communityShareNanoton: true },
      }),
      ctx.prisma.withdrawal.aggregate({ where: { status: 'CONFIRMED' }, _sum: { amountNanoton: true } }),
      ctx.prisma.quiz.count({ where: { status: 'PUBLISHED' } }),
      ctx.prisma.quizAttempt.count({ where: { status: 'SUBMITTED' } }),
      ctx.prisma.aIUsage.aggregate({ _sum: { estimatedCostMicroUsd: true } }),
      ctx.prisma.fraudCase.count({ where: { status: 'OPEN' } }),
      platformTreasuryBalance(ctx.prisma),
    ]);

  return {
    organizations,
    channels,
    communities,
    users,
    members,
    grossRevenueNanoton: cycles._sum.grossNanoton ?? 0n,
    platformFeeNanoton: cycles._sum.platformFeeNanoton ?? 0n,
    creatorShareNanoton: cycles._sum.creatorShareNanoton ?? 0n,
    communityShareNanoton: cycles._sum.communityShareNanoton ?? 0n,
    platformTreasuryNanoton: treasury,
    withdrawalsConfirmedNanoton: withdrawals._sum.amountNanoton ?? 0n,
    quizzesPublished: quizzes,
    quizAttempts: attempts,
    aiCostMicroUsd: ai._sum.estimatedCostMicroUsd ?? 0,
    openFraudCases: fraud,
  };
}
