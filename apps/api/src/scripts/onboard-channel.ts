import { loadEnvironment } from '@cle/config';
import { buildContext } from '../context.js';
import { connectChannel } from '../services/channels.js';
import { createCommunity, launchCommunity } from '../services/communities.js';
import { upsertTelegramUser } from '../services/identity.js';
import { createOrganization } from '../services/organizations.js';
import { createQuizPolicyVersion } from '../services/policies.js';

/**
 * Onboards a channel from the command line, through exactly the same services
 * the Mini App calls: organization → channel verification → community → launch →
 * AI quiz policy. Useful for operating a deployment and for driving a live test
 * without a Telegram client.
 *
 *   tsx src/scripts/onboard-channel.ts <ownerTelegramId> <@channel> [organization name]
 */
const [, , ownerId, reference, ...nameParts] = process.argv;
if (!ownerId || !reference) {
  console.error('usage: onboard-channel <ownerTelegramId> <@channel|chatId> [organization name]');
  process.exit(1);
}

const env = loadEnvironment();
const ctx = buildContext({ env });

async function main(): Promise<void> {
  const owner = await upsertTelegramUser(ctx, { id: BigInt(ownerId!) });
  const actor = { id: owner.id, isPlatformAdmin: owner.isPlatformAdmin };
  console.log(`owner: ${owner.id} (telegram ${owner.telegramId})`);

  const existingMembership = await ctx.prisma.organizationMember.findFirst({
    where: { userId: owner.id },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });
  const organization =
    existingMembership?.organization ??
    (await createOrganization(ctx, actor, { name: nameParts.join(' ') || `Organization ${ownerId}` }));
  console.log(`organization: ${organization.name} (${organization.slug})`);

  const connected = await connectChannel(ctx, actor, organization.id, { reference: reference! });
  console.log(`channel: ${connected.channel.title} — ${connected.status}`);
  console.log(`  bot is admin: ${connected.botIsAdmin}`);
  if (connected.missingRequired.length > 0) console.log(`  MISSING REQUIRED: ${connected.missingRequired.join(', ')}`);
  if (connected.missingRecommended.length > 0) console.log(`  missing optional: ${connected.missingRecommended.join(', ')}`);
  if (connected.memberCount !== undefined) console.log(`  subscribers: ${connected.memberCount}`);
  if (connected.status !== 'ACTIVE') {
    console.log('\nThe bot needs "Post messages" in the channel before a community can run. Fix that and run this again.');
    return;
  }

  const existingCommunity = await ctx.prisma.community.findUnique({ where: { channelId: connected.channel.id } });
  const community = existingCommunity ?? (await createCommunity(ctx, actor, { channelId: connected.channel.id }));
  if (community.status !== 'ACTIVE') await launchCommunity(ctx, actor, community.id);
  console.log(`community: ${community.name} (${community.slug}) — launched`);

  await createQuizPolicyVersion(ctx, {
    communityId: community.id,
    enabled: true,
    mode: 'AUTO',
    questionsPerQuiz: 3,
    minimumPostLength: 150,
    quizDelayMinutes: 0,
  });
  console.log('quiz policy: AUTO, 3 questions, no delay, minimum post length 150');
  console.log('\nPost something in the channel and CLE will publish a quiz under it.');
}

await main();
await ctx.prisma.$disconnect();
process.exit(0);
