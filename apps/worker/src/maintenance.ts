import {
  type AppContext,
  completeDueCooldowns,
  effectiveQuizPolicy,
  effectiveRewardPolicy,
  generateQuizForContent,
  processWithdrawal,
  publishQuiz,
  qualifyReferrals,
  refreshMemberCount,
  syncMembership,
  unlockDueAllocations,
} from '@cle/api';

export interface MaintenanceReport {
  communities: number;
  cooldownsCompleted: number;
  referralsQualified: number;
  allocationsUnlocked: number;
  quizzesGenerated: number;
  quizzesPublished: number;
  withdrawalsProcessed: number;
  membersResynced: number;
  errors: string[];
}

function emptyReport(): MaintenanceReport {
  return {
    communities: 0,
    cooldownsCompleted: 0,
    referralsQualified: 0,
    allocationsUnlocked: 0,
    quizzesGenerated: 0,
    quizzesPublished: 0,
    withdrawalsProcessed: 0,
    membersResynced: 0,
    errors: [],
  };
}

async function guard(report: MaintenanceReport, label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    report.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Turns pending content into published quizzes once the community's configured
 * delay has passed, so subscribers read the post before the quiz appears.
 */
export async function processDueQuizzes(ctx: AppContext, communityId: string, report: MaintenanceReport): Promise<void> {
  const policy = await effectiveQuizPolicy(ctx, communityId).catch(() => undefined);
  if (!policy?.enabled) return;

  const dueBefore = new Date(ctx.now().getTime() - policy.quizDelayMinutes * 60_000);
  const pending = await ctx.prisma.contentItem.findMany({
    where: { communityId, status: 'QUIZ_REQUESTED', publishedAt: { lte: dueBefore } },
    orderBy: { publishedAt: 'asc' },
    take: 10,
  });

  for (const item of pending) {
    await guard(report, `quiz generation for ${item.id}`, async () => {
      const generated = await generateQuizForContent(ctx, item.id);
      report.quizzesGenerated += 1;
      if (generated.autoPublishable) {
        await publishQuiz(ctx, generated.quiz.id);
        report.quizzesPublished += 1;
      }
    });
  }

  // A quiz approved by hand still needs publishing.
  const approved = await ctx.prisma.quiz.findMany({ where: { communityId, status: 'APPROVED' }, take: 10 });
  for (const quiz of approved) {
    await guard(report, `quiz publication for ${quiz.id}`, async () => {
      await publishQuiz(ctx, quiz.id);
      report.quizzesPublished += 1;
    });
  }
}

/**
 * Re-reads membership from Telegram for the members CLE has not checked
 * recently. Webhooks carry most changes, but a poll closes the gap when an
 * update was missed or the bot was added after people had already subscribed.
 */
export async function resyncStaleMembers(ctx: AppContext, communityId: string, report: MaintenanceReport, limit = 25): Promise<void> {
  const staleBefore = new Date(ctx.now().getTime() - 6 * 3_600_000);
  const members = await ctx.prisma.communityMember.findMany({
    where: { communityId, updatedAt: { lte: staleBefore }, status: { in: ['ACTIVE', 'REJOIN_COOLDOWN', 'UNKNOWN'] } },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: { userId: true },
  });
  for (const member of members) {
    await guard(report, `membership sync for ${member.userId}`, async () => {
      await syncMembership(ctx, { communityId, userId: member.userId, source: 'SCHEDULED_CHECK' });
      report.membersResynced += 1;
    });
  }
}

/** One pass of every periodic job. Safe to run repeatedly; each step is idempotent. */
export async function runMaintenancePass(ctx: AppContext): Promise<MaintenanceReport> {
  const report = emptyReport();
  const communities = await ctx.prisma.community.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  report.communities = communities.length;

  for (const community of communities) {
    const rewardPolicy = await effectiveRewardPolicy(ctx, community.id).catch(() => undefined);
    if (rewardPolicy) {
      await guard(report, `cooldowns for ${community.id}`, async () => {
        report.cooldownsCompleted += await completeDueCooldowns(ctx, community.id, rewardPolicy.rejoinCooldownDays);
      });
      await guard(report, `referrals for ${community.id}`, async () => {
        report.referralsQualified += await qualifyReferrals(ctx, community.id, rewardPolicy.referralQualificationDays);
      });
    }
    await guard(report, `quizzes for ${community.id}`, () => processDueQuizzes(ctx, community.id, report));
    await guard(report, `members for ${community.id}`, () => resyncStaleMembers(ctx, community.id, report));
    await guard(report, `member count for ${community.id}`, async () => {
      await refreshMemberCount(ctx, community.id);
    });
  }

  await guard(report, 'reward unlock', async () => {
    report.allocationsUnlocked = await unlockDueAllocations(ctx);
  });

  const locked = await ctx.prisma.withdrawal.findMany({ where: { status: 'LOCKED' }, select: { id: true }, take: 20 });
  for (const withdrawal of locked) {
    await guard(report, `withdrawal ${withdrawal.id}`, async () => {
      await processWithdrawal(ctx, withdrawal.id);
      report.withdrawalsProcessed += 1;
    });
  }

  return report;
}
