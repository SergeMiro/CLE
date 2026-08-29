import { loadEnvironment } from '@cle/config';
import { buildContext } from '../context.js';
import { upsertTelegramUser } from '../services/identity.js';
import { recordAudit } from '../services/audit.js';

/**
 * Operator tool: give a Telegram account a role in an organization, including
 * OWNER, which the API deliberately does not expose — handing over ownership is
 * not something one API call should do.
 *
 *   tsx src/scripts/grant-role.ts <telegramId> <organizationSlug> <OWNER|ADMIN|EDITOR|ANALYST|FINANCE>
 */
const [, , telegramId, slug, roleArg] = process.argv;
const ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'ANALYST', 'FINANCE'] as const;
type Role = (typeof ROLES)[number];

if (!telegramId || !slug || !roleArg || !ROLES.includes(roleArg as Role)) {
  console.error(`usage: grant-role <telegramId> <organizationSlug> <${ROLES.join('|')}>`);
  process.exit(1);
}

const ctx = buildContext({ env: loadEnvironment() });

const organization = await ctx.prisma.organization.findUnique({ where: { slug } });
if (!organization) {
  console.error(`no organization with slug "${slug}"`);
  process.exit(1);
}

const user = await upsertTelegramUser(ctx, { id: BigInt(telegramId) });
const role = roleArg as Role;
await ctx.prisma.organizationMember.upsert({
  where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
  create: { organizationId: organization.id, userId: user.id, role },
  update: { role },
});
await recordAudit(ctx, {
  actorType: 'ADMIN',
  action: 'organization.role_granted',
  entityType: 'Organization',
  entityId: organization.id,
  after: { telegramId, role },
});

console.log(`${telegramId} is now ${role} of ${organization.name} (${organization.slug})`);
await ctx.prisma.$disconnect();
process.exit(0);
