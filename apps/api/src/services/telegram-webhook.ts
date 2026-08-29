import {
  type TelegramChatMemberUpdated,
  type TelegramMessage,
  type TelegramUpdate,
  applyMembershipObservation,
  decodeStartPayload,
  inspectBotPermissions,
  isActiveMembership,
  isBanned,
  messageText,
  miniAppLink,
  updateKind,
} from '@cle/telegram';
import type { AppContext } from '../context.js';
import { ingestChannelPost } from './content.js';
import { upsertTelegramUser } from './identity.js';
import { ensureMember, refreshMemberCount } from './membership.js';
import { effectiveQuizPolicy } from './policies.js';
import { generateQuizForContent, publishQuiz, quizLink } from './quizzes.js';
import { recordReferral, resolveReferrer } from './referrals.js';

export interface UpdateOutcome {
  kind: string;
  handled: boolean;
  detail?: string;
  duplicate?: boolean;
}

/**
 * Single entry point for every Telegram update. The first thing it does is
 * resolve which tenant the update belongs to; nothing else happens until the
 * chat maps to a connected channel.
 */
export async function handleTelegramUpdate(ctx: AppContext, update: TelegramUpdate): Promise<UpdateOutcome> {
  const kind = updateKind(update);
  const externalId = String(update.update_id);

  try {
    await ctx.prisma.webhookEvent.create({
      data: { provider: 'telegram', externalId, payload: update as never },
    });
  } catch {
    // The unique (provider, externalId) index makes redelivery a no-op.
    return { kind, handled: false, duplicate: true };
  }

  let outcome: UpdateOutcome = { kind, handled: false };
  try {
    if (update.channel_post) outcome = await onChannelPost(ctx, update.channel_post);
    else if (update.my_chat_member) outcome = await onBotMembershipChanged(ctx, update.my_chat_member);
    else if (update.chat_member) outcome = await onMemberChanged(ctx, update.chat_member);
    else if (update.message) outcome = await onPrivateMessage(ctx, update.message);
    await ctx.prisma.webhookEvent.updateMany({
      where: { provider: 'telegram', externalId },
      data: { processedAt: ctx.now() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.prisma.webhookEvent.updateMany({ where: { provider: 'telegram', externalId }, data: { error: message.slice(0, 500) } });
    return { kind, handled: false, detail: message };
  }
  return outcome;
}

async function communityForChat(ctx: AppContext, chatId: number) {
  const channel = await ctx.prisma.telegramChannel.findUnique({
    where: { telegramChatId: BigInt(chatId) },
    include: { community: true },
  });
  return channel?.community ? { channel, community: channel.community } : undefined;
}

async function onChannelPost(ctx: AppContext, message: TelegramMessage): Promise<UpdateOutcome> {
  const tenant = await communityForChat(ctx, message.chat.id);
  if (!tenant) return { kind: 'channel_post', handled: false, detail: 'channel is not connected to CLE' };
  if (tenant.community.status !== 'ACTIVE') return { kind: 'channel_post', handled: false, detail: 'community is not active' };
  if (!messageText(message).trim()) return { kind: 'channel_post', handled: false, detail: 'post has no text' };

  // CLE posts its own call to action into the channel, and Telegram delivers
  // that back as a channel_post. Quizzing our own announcement would be absurd,
  // so anything the bot wrote is ignored — by author, and by message id for the
  // announcements we know we published.
  if (message.from?.is_bot) return { kind: 'channel_post', handled: false, detail: 'ignoring the bot\'s own post' };
  const ownAnnouncement = await ctx.prisma.quiz.findFirst({
    where: { communityId: tenant.community.id, publishedMessageId: BigInt(message.message_id) },
    select: { id: true },
  });
  if (ownAnnouncement) return { kind: 'channel_post', handled: false, detail: 'ignoring a quiz announcement' };

  const ingested = await ingestChannelPost(ctx, tenant.community.id, message);
  if (!ingested.quizRequested) return { kind: 'channel_post', handled: true, detail: ingested.skipReason ?? 'skipped' };

  const policy = await effectiveQuizPolicy(ctx, tenant.community.id);
  // A delayed quiz is picked up by the worker, so readers see the post first.
  if (policy.quizDelayMinutes > 0) return { kind: 'channel_post', handled: true, detail: 'quiz scheduled' };

  const generated = await generateQuizForContent(ctx, ingested.item.id);
  if (!generated.autoPublishable) return { kind: 'channel_post', handled: true, detail: 'quiz held for review' };
  await publishQuiz(ctx, generated.quiz.id);
  return { kind: 'channel_post', handled: true, detail: 'quiz published' };
}

/** The bot's own rights changed: promote, demote or disconnect the channel. */
async function onBotMembershipChanged(ctx: AppContext, event: TelegramChatMemberUpdated): Promise<UpdateOutcome> {
  const channel = await ctx.prisma.telegramChannel.findUnique({ where: { telegramChatId: BigInt(event.chat.id) } });
  if (!channel) return { kind: 'my_chat_member', handled: false, detail: 'channel is not connected to CLE' };

  const report = inspectBotPermissions(event.new_chat_member);
  await ctx.prisma.telegramChannel.update({
    where: { id: channel.id },
    data: {
      status: report.status,
      botIsAdmin: report.isAdmin,
      permissions: { granted: report.granted } as never,
      missingPermissions: [...report.missingRequired, ...report.missingRecommended],
      lastCheckedAt: ctx.now(),
      verifiedAt: report.status === 'ACTIVE' ? ctx.now() : channel.verifiedAt,
    },
  });
  return { kind: 'my_chat_member', handled: true, detail: report.status };
}

/** A subscriber joined or left; membership is the basis of every reward. */
async function onMemberChanged(ctx: AppContext, event: TelegramChatMemberUpdated): Promise<UpdateOutcome> {
  const tenant = await communityForChat(ctx, event.chat.id);
  if (!tenant) return { kind: 'chat_member', handled: false, detail: 'channel is not connected to CLE' };
  if (event.new_chat_member.user.is_bot) return { kind: 'chat_member', handled: false, detail: 'ignoring a bot' };

  const user = await upsertTelegramUser(ctx, {
    id: BigInt(event.new_chat_member.user.id),
    ...(event.new_chat_member.user.username ? { username: event.new_chat_member.user.username } : {}),
    ...(event.new_chat_member.user.first_name ? { firstName: event.new_chat_member.user.first_name } : {}),
    ...(event.new_chat_member.user.last_name ? { lastName: event.new_chat_member.user.last_name } : {}),
  });
  const member = await ensureMember(ctx, tenant.community.id, user.id);
  const observedAt = new Date(event.date * 1000);

  if (isBanned(event.new_chat_member)) {
    await ctx.prisma.communityMember.update({
      where: { id: member.id },
      data: { status: 'BANNED', eligibility: 'BLOCKED', leaveAt: observedAt },
    });
    await ctx.prisma.membershipEvent.create({
      data: { memberId: member.id, type: 'BAN', telegramStatus: event.new_chat_member.status, occurredAt: observedAt, source: 'WEBHOOK' },
    });
    await refreshMemberCount(ctx, tenant.community.id);
    return { kind: 'chat_member', handled: true, detail: 'banned' };
  }

  const { next, event: transition } = applyMembershipObservation(
    {
      status: member.status,
      rejoinCount: member.rejoinCount,
      ...(member.firstJoinAt ? { firstJoinAt: member.firstJoinAt } : {}),
      ...(member.currentJoinAt ? { currentJoinAt: member.currentJoinAt } : {}),
      ...(member.leaveAt ? { lastLeaveAt: member.leaveAt } : {}),
    },
    isActiveMembership(event.new_chat_member),
    observedAt,
  );
  if (!transition) return { kind: 'chat_member', handled: true, detail: 'no change' };

  await ctx.prisma.communityMember.update({
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
    data: { memberId: member.id, type: transition, telegramStatus: event.new_chat_member.status, occurredAt: observedAt, source: 'WEBHOOK' },
  });
  await refreshMemberCount(ctx, tenant.community.id);
  return { kind: 'chat_member', handled: true, detail: transition };
}

/** /start in a private chat: attribute the referral and hand the person the Mini App. */
async function onPrivateMessage(ctx: AppContext, message: TelegramMessage): Promise<UpdateOutcome> {
  if (message.chat.type !== 'private' || !message.from) return { kind: 'message', handled: false };
  const text = messageText(message).trim();
  if (!text.startsWith('/start')) return { kind: 'message', handled: false, detail: 'not a start command' };

  const user = await upsertTelegramUser(ctx, {
    id: BigInt(message.from.id),
    ...(message.from.username ? { username: message.from.username } : {}),
    ...(message.from.first_name ? { firstName: message.from.first_name } : {}),
    ...(message.from.last_name ? { lastName: message.from.last_name } : {}),
  });

  const payload = decodeStartPayload(text.slice('/start'.length).trim());
  let link = ctx.env.TELEGRAM_BOT_USERNAME
    ? miniAppLink({ botUsername: ctx.env.TELEGRAM_BOT_USERNAME, appName: 'app' })
    : ctx.env.MINI_APP_URL;
  let reply = 'Open CLE to see your communities, quizzes and balance.';

  if (payload?.kind === 'referral') {
    const referrerId = await resolveReferrer(ctx, payload.referralCode);
    if (referrerId) {
      await recordReferral(ctx, {
        referrerUserId: referrerId,
        referredUserId: user.id,
        ...(payload.communityId ? { communityId: payload.communityId } : {}),
      });
      reply = 'You were invited to CLE. Join the channel, take the quizzes and start earning.';
    }
  } else if (payload?.kind === 'quiz') {
    link = quizLink(ctx, payload.quizId);
    reply = 'Your quiz is ready.';
  }

  await ctx.telegram.sendMessage({
    chatId: message.chat.id,
    text: reply,
    replyMarkup: { inline_keyboard: [[{ text: 'Open CLE', url: link }]] },
  });
  return { kind: 'message', handled: true, detail: payload?.kind ?? 'start' };
}
