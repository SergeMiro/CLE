import { daysBetween } from '@cle/core';
import type { CommunityMember, MembershipEventSource } from '@cle/db';
import { type MembershipState, applyMembershipObservation, isActiveMembership, isBanned } from '@cle/telegram';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';

export async function ensureMember(ctx: AppContext, communityId: string, userId: string): Promise<CommunityMember> {
  return ctx.prisma.communityMember.upsert({
    where: { communityId_userId: { communityId, userId } },
    create: { communityId, userId },
    update: {},
  });
}

function toState(member: CommunityMember): MembershipState {
  return {
    status: member.status,
    rejoinCount: member.rejoinCount,
    ...(member.firstJoinAt ? { firstJoinAt: member.firstJoinAt } : {}),
    ...(member.currentJoinAt ? { currentJoinAt: member.currentJoinAt } : {}),
    ...(member.leaveAt ? { lastLeaveAt: member.leaveAt } : {}),
  };
}

export interface MembershipSyncResult {
  member: CommunityMember;
  changed: boolean;
  telegramStatus: string;
}

/**
 * Single source of truth for "is this person in the channel?". Telegram is
 * always the authority; CLE only records the transitions it observes.
 */
export async function syncMembership(
  ctx: AppContext,
  input: { communityId: string; userId: string; source: MembershipEventSource; observedAt?: Date },
): Promise<MembershipSyncResult> {
  const community = await ctx.prisma.community.findUnique({
    where: { id: input.communityId },
    include: { channel: { select: { telegramChatId: true } } },
  });
  if (!community) throw notFound('community not found');
  const user = await ctx.prisma.user.findUnique({ where: { id: input.userId }, select: { telegramId: true } });
  if (!user) throw notFound('user not found');

  const chatMember = await ctx.telegram.getChatMember(Number(community.channel.telegramChatId), user.telegramId);
  const observedAt = input.observedAt ?? ctx.now();
  const member = await ensureMember(ctx, input.communityId, input.userId);

  if (isBanned(chatMember)) {
    const banned = await ctx.prisma.communityMember.update({
      where: { id: member.id },
      data: { status: 'BANNED', eligibility: 'BLOCKED', leaveAt: observedAt },
    });
    if (member.status !== 'BANNED') {
      await ctx.prisma.membershipEvent.create({
        data: { memberId: member.id, type: 'BAN', telegramStatus: chatMember.status, occurredAt: observedAt, source: input.source },
      });
      await refreshMemberCount(ctx, input.communityId);
    }
    return { member: banned, changed: member.status !== 'BANNED', telegramStatus: chatMember.status };
  }

  const { next, event } = applyMembershipObservation(toState(member), isActiveMembership(chatMember), observedAt);
  if (!event) return { member, changed: false, telegramStatus: chatMember.status };

  const updated = await ctx.prisma.communityMember.update({
    where: { id: member.id },
    data: {
      status: next.status,
      firstJoinAt: next.firstJoinAt ?? null,
      currentJoinAt: next.currentJoinAt ?? null,
      leaveAt: next.lastLeaveAt ?? null,
      rejoinCount: next.rejoinCount,
      eligibility: next.status === 'ACTIVE' || next.status === 'REJOIN_COOLDOWN' ? 'ELIGIBLE' : 'PENDING',
    },
  });
  await ctx.prisma.membershipEvent.create({
    data: { memberId: member.id, type: event, telegramStatus: chatMember.status, occurredAt: observedAt, source: input.source },
  });
  await refreshMemberCount(ctx, input.communityId);
  return { member: updated, changed: true, telegramStatus: chatMember.status };
}

/**
 * A member who rejoined sits in REJOIN_COOLDOWN so a leave-and-return cannot
 * farm the growth pool; this promotes them once the cooldown has elapsed.
 */
export async function completeDueCooldowns(ctx: AppContext, communityId: string, cooldownDays: number): Promise<number> {
  const threshold = new Date(ctx.now().getTime() - cooldownDays * 86_400_000);
  const result = await ctx.prisma.communityMember.updateMany({
    where: { communityId, status: 'REJOIN_COOLDOWN', currentJoinAt: { lte: threshold } },
    data: { status: 'ACTIVE' },
  });
  return result.count;
}

export async function refreshMemberCount(ctx: AppContext, communityId: string): Promise<number> {
  const memberCount = await ctx.prisma.communityMember.count({ where: { communityId, status: { in: ['ACTIVE', 'REJOIN_COOLDOWN'] } } });
  await ctx.prisma.community.update({ where: { id: communityId }, data: { memberCount } });
  return memberCount;
}

export function membershipAgeDays(member: Pick<CommunityMember, 'currentJoinAt'>, at: Date): number {
  return member.currentJoinAt ? daysBetween(member.currentJoinAt, at) : 0;
}

/**
 * Makes sure CLE knows whether this person is in the channel, asking Telegram
 * when it does not.
 *
 * Membership arrives by webhook, but only for people who join after the bot was
 * made an administrator — everyone who was already subscribed is invisible until
 * something asks. Someone opening a quiz from a channel post has obviously seen
 * that channel, so requiring them to find a settings screen and press a button
 * first is a dead end.
 */
export async function ensureMembershipKnown(
  ctx: AppContext,
  input: { communityId: string; userId: string; source: MembershipEventSource; maxAgeMinutes?: number },
): Promise<CommunityMember> {
  const member = await ctx.prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId: input.communityId, userId: input.userId } },
  });

  const active = member?.status === 'ACTIVE' || member?.status === 'REJOIN_COOLDOWN';
  const stale =
    !member ||
    (!active && member.status !== 'BANNED' &&
      member.updatedAt.getTime() < ctx.now().getTime() - (input.maxAgeMinutes ?? 5) * 60_000);
  if (!stale) return member;

  try {
    const synced = await syncMembership(ctx, {
      communityId: input.communityId,
      userId: input.userId,
      source: input.source,
    });
    return synced.member;
  } catch {
    // Telegram being unavailable must not invent a membership; fall back to what is known.
    return member ?? ensureMember(ctx, input.communityId, input.userId);
  }
}
