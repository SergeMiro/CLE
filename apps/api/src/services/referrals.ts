import { daysBetween } from '@cle/core';
import type { Referral } from '@cle/db';
import type { AppContext } from '../context.js';
import { badRequest } from '../errors.js';

export interface ReferralAttribution {
  referrerUserId: string;
  referredUserId: string;
  communityId?: string;
}

/**
 * Referrals are recorded per community, because that is where the reward pool
 * lives. A platform-level referral is kept too, for CLE's own growth reporting.
 */
export async function recordReferral(ctx: AppContext, input: ReferralAttribution): Promise<Referral | undefined> {
  if (input.referrerUserId === input.referredUserId) return undefined;
  const scope = input.communityId ? 'COMMUNITY' : 'PLATFORM';

  const communityKey = input.communityId ?? 'platform';
  const existing = await ctx.prisma.referral.findUnique({
    where: { scope_communityKey_referredUserId: { scope, communityKey, referredUserId: input.referredUserId } },
  });
  // First attribution wins; a later link cannot steal an existing referral.
  if (existing) return existing;

  if (scope === 'PLATFORM') {
    const referred = await ctx.prisma.user.findUnique({ where: { id: input.referredUserId }, select: { referredByUserId: true } });
    if (!referred?.referredByUserId) {
      await ctx.prisma.user.update({ where: { id: input.referredUserId }, data: { referredByUserId: input.referrerUserId } });
    }
  }

  return ctx.prisma.referral.create({
    data: {
      scope,
      communityId: input.communityId ?? null,
      communityKey,
      referrerUserId: input.referrerUserId,
      referredUserId: input.referredUserId,
      status: 'PENDING',
    },
  });
}

export async function resolveReferrer(ctx: AppContext, referralCode: string): Promise<string | undefined> {
  if (!/^[A-Za-z0-9-]{4,24}$/.test(referralCode)) throw badRequest('malformed referral code');
  const user = await ctx.prisma.user.findUnique({ where: { referralCode }, select: { id: true } });
  return user?.id;
}

/**
 * A referral only counts once the invited member has actually stayed in the
 * channel for the qualification period — that is what makes it worth paying for.
 */
export async function qualifyReferrals(ctx: AppContext, communityId: string, qualificationDays: number): Promise<number> {
  const pending = await ctx.prisma.referral.findMany({
    where: { communityId, scope: 'COMMUNITY', status: 'PENDING' },
    select: { id: true, referredUserId: true },
  });
  if (pending.length === 0) return 0;

  const members = await ctx.prisma.communityMember.findMany({
    where: { communityId, userId: { in: pending.map((referral) => referral.referredUserId) } },
    select: { userId: true, status: true, currentJoinAt: true },
  });
  const byUser = new Map(members.map((member) => [member.userId, member]));
  const now = ctx.now();

  const qualified: string[] = [];
  const rejected: string[] = [];
  for (const referral of pending) {
    const member = byUser.get(referral.referredUserId);
    if (!member) continue;
    if (member.status === 'BANNED') {
      rejected.push(referral.id);
      continue;
    }
    const active = member.status === 'ACTIVE' || member.status === 'REJOIN_COOLDOWN';
    if (active && member.currentJoinAt && daysBetween(member.currentJoinAt, now) >= qualificationDays) qualified.push(referral.id);
  }

  if (rejected.length > 0) {
    await ctx.prisma.referral.updateMany({
      where: { id: { in: rejected } },
      data: { status: 'REJECTED', rejectedReason: 'the invited member was banned' },
    });
  }
  if (qualified.length > 0) {
    await ctx.prisma.referral.updateMany({ where: { id: { in: qualified } }, data: { status: 'QUALIFIED', qualifiedAt: now } });
  }
  return qualified.length;
}

/** Referral units a member brings into one reward cycle. */
export async function qualifiedReferralCounts(ctx: AppContext, communityId: string): Promise<Map<string, number>> {
  const grouped = await ctx.prisma.referral.groupBy({
    by: ['referrerUserId'],
    where: { communityId, scope: 'COMMUNITY', status: { in: ['QUALIFIED', 'REWARDED'] } },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.referrerUserId, row._count._all]));
}
