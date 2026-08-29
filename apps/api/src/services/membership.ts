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
