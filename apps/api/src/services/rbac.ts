import type { OrganizationRole } from '@cle/db';
import type { AppContext } from '../context.js';
import { forbidden, notFound } from '../errors.js';

/** Widest to narrowest. OWNER implies every other role. */
export const ROLE_RANK: Record<OrganizationRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  FINANCE: 3,
  EDITOR: 2,
  ANALYST: 1,
};

export const ROLE_CAPABILITIES: Record<string, OrganizationRole[]> = {
  'organization:manage': ['OWNER', 'ADMIN'],
  'channel:connect': ['OWNER', 'ADMIN'],
  'community:configure': ['OWNER', 'ADMIN'],
  'revenue:manage': ['OWNER', 'ADMIN', 'FINANCE'],
  'reward:approve': ['OWNER', 'ADMIN', 'FINANCE'],
  'withdrawal:request': ['OWNER', 'FINANCE'],
  'content:manage': ['OWNER', 'ADMIN', 'EDITOR'],
  'quiz:manage': ['OWNER', 'ADMIN', 'EDITOR'],
  'analytics:read': ['OWNER', 'ADMIN', 'FINANCE', 'EDITOR', 'ANALYST'],
};

export type Capability = keyof typeof ROLE_CAPABILITIES;

export interface OrganizationAccess {
  organizationId: string;
  role: OrganizationRole | 'PLATFORM_ADMIN';
}

export interface Actor {
  id: string;
  isPlatformAdmin: boolean;
}

/**
 * Resolves what an actor may do inside one organization. A platform admin can
 * always read, but is recorded distinctly so audit logs stay honest.
 */
export async function requireOrganizationAccess(
  ctx: AppContext,
  actor: Actor,
  organizationId: string,
  capability: Capability,
): Promise<OrganizationAccess> {
  const organization = await ctx.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, status: true } });
  if (!organization) throw notFound('organization not found');

  if (actor.isPlatformAdmin) return { organizationId, role: 'PLATFORM_ADMIN' };

  const membership = await ctx.prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: actor.id } },
    select: { role: true },
  });
  // An outsider must not learn that an organization exists at all.
  if (!membership) throw notFound('organization not found');

  const allowed = ROLE_CAPABILITIES[capability] ?? [];
  if (!allowed.includes(membership.role)) throw forbidden(`role ${membership.role} cannot perform ${capability}`);
  if (organization.status !== 'ACTIVE') throw forbidden(`organization is ${organization.status.toLowerCase()}`);
  return { organizationId, role: membership.role };
}

/** Same check, but starting from a community: the tenant is derived, never trusted from the request. */
export async function requireCommunityAccess(
  ctx: AppContext,
  actor: Actor,
  communityId: string,
  capability: Capability,
): Promise<OrganizationAccess & { communityId: string }> {
  const community = await ctx.prisma.community.findUnique({ where: { id: communityId }, select: { organizationId: true } });
  if (!community) throw notFound('community not found');
  const access = await requireOrganizationAccess(ctx, actor, community.organizationId, capability);
  return { ...access, communityId };
}

export function requirePlatformAdmin(actor: Actor): void {
  if (!actor.isPlatformAdmin) throw forbidden('platform administrator access is required');
}
