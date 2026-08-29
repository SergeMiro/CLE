import { randomBytes } from 'node:crypto';
import type { Organization } from '@cle/db';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { recordAudit } from './audit.js';
import { type Actor, requireOrganizationAccess } from './rbac.js';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Validates a slug a person typed. Strict on purpose: it appears in public links. */
export function normaliseSlug(input: string): string {
  const slug = slugify(input);
  if (!SLUG.test(slug)) throw badRequest('slug must be 3-40 characters of lowercase letters, digits and dashes');
  return slug;
}

/**
 * Derives a slug from a display name. A name written in Cyrillic, Arabic or any
 * other non-Latin script leaves nothing usable behind, so a readable identifier
 * is generated instead of rejecting the name.
 */
export function deriveSlug(name: string, prefix = 'org'): string {
  const slug = slugify(name);
  if (SLUG.test(slug)) return slug;
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

export async function createOrganization(ctx: AppContext, actor: Actor, input: { name: string; slug?: string | undefined }): Promise<Organization> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw badRequest('organization name must be 2-120 characters');
  const slug = input.slug ? normaliseSlug(input.slug) : deriveSlug(name, 'org');
  if (await ctx.prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
    throw conflict(`the slug "${slug}" is already taken`);
  }

  const organization = await ctx.prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({ data: { name, slug, ownerUserId: actor.id } });
    await tx.organizationMember.create({ data: { organizationId: created.id, userId: actor.id, role: 'OWNER' } });
    return created;
  });

  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'organization.created',
    entityType: 'Organization',
    entityId: organization.id,
    after: { name, slug },
  });
  return organization;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
  channelCount: number;
  communityCount: number;
}

export async function listOrganizationsForUser(ctx: AppContext, actor: Actor): Promise<OrganizationSummary[]> {
  const memberships = await ctx.prisma.organizationMember.findMany({
    where: { userId: actor.id },
    include: { organization: { include: { _count: { select: { channels: true, communities: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((membership) => ({
    id: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    role: membership.role,
    status: membership.organization.status,
    channelCount: membership.organization._count.channels,
    communityCount: membership.organization._count.communities,
  }));
}

export async function addOrganizationMember(
  ctx: AppContext,
  actor: Actor,
  organizationId: string,
  input: { telegramId: bigint; role: 'ADMIN' | 'EDITOR' | 'ANALYST' | 'FINANCE' },
): Promise<{ userId: string; role: string }> {
  await requireOrganizationAccess(ctx, actor, organizationId, 'organization:manage');
  const user = await ctx.prisma.user.findUnique({ where: { telegramId: input.telegramId }, select: { id: true } });
  if (!user) throw notFound('that person has not opened the CLE Mini App yet');
  const member = await ctx.prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    create: { organizationId, userId: user.id, role: input.role, invitedByUserId: actor.id },
    update: { role: input.role },
  });
  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'organization.member_added',
    entityType: 'Organization',
    entityId: organizationId,
    after: { userId: user.id, role: input.role },
  });
  return { userId: member.userId, role: member.role };
}
