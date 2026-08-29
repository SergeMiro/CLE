import { DEFAULT_LOYALTY_TIERS } from '@cle/core';
import type { Community } from '@cle/db';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound, unprocessable } from '../errors.js';
import { recordAudit } from './audit.js';
import { deriveSlug, normaliseSlug } from './organizations.js';
import { createQuizPolicyVersion, createRevenuePolicyVersion, createRewardPolicyVersion } from './policies.js';
import { type Actor, requireCommunityAccess, requireOrganizationAccess } from './rbac.js';

export interface CreateCommunityInput {
  channelId: string;
  name?: string | undefined;
  slug?: string | undefined;
  description?: string | undefined;
  language?: string | undefined;
  /** Creator share of the post-fee remainder, in basis points (0-1000 by default). */
  creatorShareBps?: number | undefined;
}

/**
 * A community is created from a verified channel and comes up with a complete
 * set of default policies, so a creator can launch without touching every
 * setting first.
 */
export async function createCommunity(ctx: AppContext, actor: Actor, input: CreateCommunityInput): Promise<Community> {
  const channel = await ctx.prisma.telegramChannel.findUnique({ where: { id: input.channelId }, include: { community: true } });
  if (!channel) throw notFound('channel not found');
  await requireOrganizationAccess(ctx, actor, channel.organizationId, 'community:configure');
  if (channel.community) throw conflict('this channel already has a community');
  if (channel.status === 'PENDING' || channel.status === 'DISCONNECTED') {
    throw unprocessable('add the CLE bot as a channel administrator and verify the channel first');
  }

  const name = (input.name ?? channel.title).trim();
  if (name.length < 2) throw badRequest('community name is too short');
  const slug = input.slug ? normaliseSlug(input.slug) : deriveSlug(channel.username ?? name, 'community');
  if (await ctx.prisma.community.findUnique({ where: { slug }, select: { id: true } })) throw conflict(`the slug "${slug}" is taken`);

  const community = await ctx.prisma.community.create({
    data: {
      organizationId: channel.organizationId,
      channelId: channel.id,
      slug,
      name,
      description: input.description ?? channel.description ?? null,
      language: input.language ?? 'en',
      status: 'DRAFT',
      levels: {
        create: DEFAULT_LOYALTY_TIERS.map((tier, index) => ({
          key: tier.key,
          name: tier.key.charAt(0).toUpperCase() + tier.key.slice(1),
          minDays: tier.minDays,
          weightBps: tier.weightBps,
          sortOrder: index,
        })),
      },
    },
  });

  await createRevenuePolicyVersion(ctx, {
    communityId: community.id,
    creatorShareBps: input.creatorShareBps ?? 0,
    createdByUserId: actor.id,
    effectiveFrom: new Date(0),
  });
  await createRewardPolicyVersion(ctx, {
    communityId: community.id,
    growthBps: ctx.env.DEFAULT_GROWTH_BPS,
    loyaltyBps: ctx.env.DEFAULT_LOYALTY_BPS,
    referralBps: ctx.env.DEFAULT_REFERRAL_BPS,
    learningBps: ctx.env.DEFAULT_LEARNING_BPS,
    createdByUserId: actor.id,
    effectiveFrom: new Date(0),
  });
  await createQuizPolicyVersion(ctx, {
    communityId: community.id,
    language: input.language ?? 'en',
    effectiveFrom: new Date(0),
  });

  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'community.created',
    entityType: 'Community',
    entityId: community.id,
    after: { slug, channelId: channel.id },
  });
  return community;
}

export async function launchCommunity(ctx: AppContext, actor: Actor, communityId: string): Promise<Community> {
  await requireCommunityAccess(ctx, actor, communityId, 'community:configure');
  const community = await ctx.prisma.community.findUniqueOrThrow({ where: { id: communityId }, include: { channel: true } });
  if (community.channel.status !== 'ACTIVE') throw unprocessable('the channel must be ACTIVE before the community can launch');
  const launched = await ctx.prisma.community.update({
    where: { id: communityId },
    data: { status: 'ACTIVE', launchedAt: community.launchedAt ?? ctx.now() },
  });
  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'community.launched',
    entityType: 'Community',
    entityId: communityId,
    after: { status: 'ACTIVE' },
  });
  return launched;
}

export async function setCommunityStatus(
  ctx: AppContext,
  actor: Actor,
  communityId: string,
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED',
): Promise<Community> {
  await requireCommunityAccess(ctx, actor, communityId, 'community:configure');
  return ctx.prisma.community.update({ where: { id: communityId }, data: { status } });
}

export async function communityBySlugOrId(ctx: AppContext, identifier: string) {
  const community = await ctx.prisma.community.findFirst({
    where: { OR: [{ slug: identifier }, ...(isUuid(identifier) ? [{ id: identifier }] : [])] },
    include: { channel: { select: { username: true, title: true, telegramChatId: true, status: true } } },
  });
  if (!community) throw notFound('community not found');
  return community;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function listCommunities(ctx: AppContext, actor: Actor, organizationId: string) {
  await requireOrganizationAccess(ctx, actor, organizationId, 'analytics:read');
  return ctx.prisma.community.findMany({
    where: { organizationId },
    include: { channel: { select: { title: true, username: true, status: true } }, _count: { select: { members: true, quizzes: true } } },
    orderBy: { createdAt: 'asc' },
  });
}
