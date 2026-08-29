import { loadEnvironment } from '@cle/config';
import { FileMockTelegramClient } from '@cle/telegram';
import { buildContext } from '../context.js';
import { upsertTelegramUser } from '../services/identity.js';
import { syncMembership } from '../services/membership.js';

/**
 * Adds one simulated subscriber to a demo community, so the Mini App can be
 * clicked through as a brand-new member. APP_MODE=mock only.
 */
const env = loadEnvironment();
if (env.APP_MODE !== 'mock') {
  console.error('demo-join only runs with APP_MODE=mock');
  process.exit(1);
}

const telegramId = Number(process.argv[2] ?? 111_000_104);
const slug = process.argv[3] ?? 'cle-science-daily';

const ctx = buildContext({ env });
const community = await ctx.prisma.community.findFirstOrThrow({
  where: { slug },
  include: { channel: { select: { telegramChatId: true } } },
});

(ctx.telegram as FileMockTelegramClient).setMember(Number(community.channel.telegramChatId), telegramId, {
  user: { id: telegramId },
  status: 'member',
});
const user = await upsertTelegramUser(ctx, { id: BigInt(telegramId), username: `learner_${telegramId}`, firstName: 'Demo Learner' });
const result = await syncMembership(ctx, { communityId: community.id, userId: user.id, source: 'ONBOARDING_CHECK' });

console.log(`${telegramId} is now ${result.member.status} in ${community.name}`);
console.log(`open ${env.MINI_APP_URL}/learn?mockUser=${telegramId}`);
await ctx.prisma.$disconnect();
process.exit(0);
