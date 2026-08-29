import type { TelegramChannel } from '@cle/db';
import { TelegramApiError, inspectBotPermissions } from '@cle/telegram';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound, unprocessable } from '../errors.js';
import { recordAudit } from './audit.js';
import { type Actor, requireOrganizationAccess } from './rbac.js';

/** Accepts "@name", "https://t.me/name", "name" or a numeric -100… chat id. */
export function normaliseChannelReference(input: string): string | number {
  const value = input.trim();
  if (/^-?\d+$/.test(value)) return Number(value);
  const username = value
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9_]{4,32}$/.test(username)) throw badRequest('that does not look like a Telegram channel');
  return `@${username}`;
}

export interface ChannelVerification {
  channel: TelegramChannel;
  status: TelegramChannel['status'];
  missingRequired: string[];
  missingRecommended: string[];
  botIsAdmin: boolean;
  memberCount: number | undefined;
}

/**
 * Reads the live channel state and reconciles the stored record with it. Called
 * both when a creator connects a channel and whenever CLE re-verifies one, so a
 * revoked permission downgrades the channel to DEGRADED on its own.
 */
async function inspectChannel(ctx: AppContext, reference: string | number) {
  let chat;
  try {
    chat = await ctx.telegram.getChat(reference);
  } catch (error) {
    throw error instanceof TelegramApiError
      ? unprocessable(`CLE cannot read that channel: ${error.message}. Add @${ctx.env.TELEGRAM_BOT_USERNAME ?? 'the CLE bot'} as an administrator first.`)
      : error;
  }
  if (chat.type !== 'channel' && chat.type !== 'supergroup') throw badRequest('only channels and supergroups can be connected');

  const me = await ctx.telegram.getMe();
  const botMember = await ctx.telegram.getChatMember(chat.id, me.id).catch(() => undefined);
  const permissions = inspectBotPermissions(botMember);
  const memberCount = await ctx.telegram.getChatMemberCount(chat.id).catch(() => undefined);
  return { chat, me, permissions, memberCount };
}

export async function connectChannel(
  ctx: AppContext,
  actor: Actor,
  organizationId: string,
  input: { reference: string },
): Promise<ChannelVerification> {
  await requireOrganizationAccess(ctx, actor, organizationId, 'channel:connect');
  const reference = normaliseChannelReference(input.reference);
  const { chat, me, permissions, memberCount } = await inspectChannel(ctx, reference);

  const existing = await ctx.prisma.telegramChannel.findUnique({ where: { telegramChatId: BigInt(chat.id) } });
  if (existing && existing.organizationId !== organizationId) {
    throw conflict('that channel is already connected to another CLE organization');
  }

  const data = {
    username: chat.username ?? null,
    title: chat.title ?? String(chat.id),
    description: chat.description ?? null,
    status: permissions.status === 'ACTIVE' ? ('ACTIVE' as const) : permissions.status === 'DEGRADED' ? ('DEGRADED' as const) : ('PENDING' as const),
    botIsAdmin: permissions.isAdmin,
    permissions: { granted: permissions.granted } as never,
    missingPermissions: [...permissions.missingRequired, ...permissions.missingRecommended],
    memberCount: memberCount ?? null,
    lastCheckedAt: ctx.now(),
    verifiedAt: permissions.status === 'ACTIVE' ? ctx.now() : existing?.verifiedAt ?? null,
  };

  const channel = existing
    ? await ctx.prisma.telegramChannel.update({ where: { id: existing.id }, data })
    : await ctx.prisma.telegramChannel.create({ data: { organizationId, telegramChatId: BigInt(chat.id), ...data } });

  if (permissions.isAdmin) {
    await ctx.prisma.telegramBotInstallation.create({
      data: {
        channelId: channel.id,
        botId: BigInt(me.id),
        addedByUserId: actor.id,
        permissions: { granted: permissions.granted, missing: permissions.missingRequired } as never,
      },
    });
  }

  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: existing ? 'channel.reverified' : 'channel.connected',
    entityType: 'TelegramChannel',
    entityId: channel.id,
    after: { status: channel.status, missing: channel.missingPermissions },
  });

  return {
    channel,
    status: channel.status,
    missingRequired: permissions.missingRequired,
    missingRecommended: permissions.missingRecommended,
    botIsAdmin: permissions.isAdmin,
    memberCount,
  };
}

export async function verifyChannel(ctx: AppContext, actor: Actor, channelId: string): Promise<ChannelVerification> {
  const channel = await ctx.prisma.telegramChannel.findUnique({ where: { id: channelId } });
  if (!channel) throw notFound('channel not found');
  await requireOrganizationAccess(ctx, actor, channel.organizationId, 'channel:connect');
  return connectChannel(ctx, actor, channel.organizationId, { reference: String(channel.telegramChatId) });
}

export async function listChannels(ctx: AppContext, actor: Actor, organizationId: string) {
  await requireOrganizationAccess(ctx, actor, organizationId, 'analytics:read');
  return ctx.prisma.telegramChannel.findMany({
    where: { organizationId },
    include: { community: { select: { id: true, slug: true, name: true, status: true, memberCount: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function setMonetization(
  ctx: AppContext,
  actor: Actor,
  channelId: string,
  status: 'DISABLED' | 'ENABLED' | 'PAUSED',
): Promise<TelegramChannel> {
  const channel = await ctx.prisma.telegramChannel.findUnique({ where: { id: channelId } });
  if (!channel) throw notFound('channel not found');
  await requireOrganizationAccess(ctx, actor, channel.organizationId, 'revenue:manage');
  if (status === 'ENABLED' && channel.status !== 'ACTIVE') {
    throw unprocessable('the channel must be verified and fully permissioned before monetization can be enabled');
  }
  const updated = await ctx.prisma.telegramChannel.update({ where: { id: channelId }, data: { monetizationStatus: status } });
  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'channel.monetization_changed',
    entityType: 'TelegramChannel',
    entityId: channelId,
    before: { monetizationStatus: channel.monetizationStatus },
    after: { monetizationStatus: status },
  });
  return updated;
}
