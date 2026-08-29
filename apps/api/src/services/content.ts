import { detectLanguage } from '@cle/ai';
import type { ContentItem } from '@cle/db';
import { type TelegramMessage, messageText, messageUrl } from '@cle/telegram';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { effectiveQuizPolicy } from './policies.js';

export interface IngestResult {
  item: ContentItem;
  created: boolean;
  /** True when the post is eligible for an automatic quiz under the community policy. */
  quizRequested: boolean;
  skipReason?: string;
}

function classify(text: string): { category: string | undefined; topics: string[] } {
  const hashtags = [...text.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)].map((match) => (match[1] ?? '').toLowerCase());
  return { category: hashtags[0], topics: [...new Set(hashtags)].slice(0, 10) };
}

/**
 * Every channel post becomes a ContentItem. Whether it becomes a quiz is a
 * policy decision made here, not by the caller: too short, wrong category or a
 * daily limit already reached all end as a recorded skip reason.
 */
export async function ingestChannelPost(ctx: AppContext, communityId: string, message: TelegramMessage): Promise<IngestResult> {
  const community = await ctx.prisma.community.findUnique({
    where: { id: communityId },
    include: { channel: { select: { id: true, username: true, telegramChatId: true } } },
  });
  if (!community) throw notFound('community not found');

  const text = messageText(message);
  const { category, topics } = classify(text);
  const publishedAt = new Date(message.date * 1000);

  const existing = await ctx.prisma.contentItem.findUnique({
    where: { channelId_telegramMessageId: { channelId: community.channel.id, telegramMessageId: BigInt(message.message_id) } },
  });

  const policy = await effectiveQuizPolicy(ctx, communityId).catch(() => undefined);
  const skipReason = await evaluateSkip(ctx, communityId, text, category, policy);

  const data = {
    text,
    // Detected per post: a community's default language says nothing about the
    // language a particular post was written in.
    language: detectLanguage(text, community.language),
    category: category ?? null,
    topics,
    mediaMetadata: (message.photo ? { kind: 'photo' } : message.video ? { kind: 'video' } : null) as never,
    telegramMessageUrl: messageUrl(message.chat, message.message_id) ?? null,
    status: skipReason ? ('SKIPPED' as const) : ('QUIZ_REQUESTED' as const),
    skipReason: skipReason ?? null,
    publishedAt,
  };

  const item = existing
    ? await ctx.prisma.contentItem.update({ where: { id: existing.id }, data })
    : await ctx.prisma.contentItem.create({
        data: {
          communityId,
          channelId: community.channel.id,
          telegramMessageId: BigInt(message.message_id),
          ...data,
        },
      });

  return {
    item,
    created: !existing,
    quizRequested: !skipReason,
    ...(skipReason ? { skipReason } : {}),
  };
}

async function evaluateSkip(
  ctx: AppContext,
  communityId: string,
  text: string,
  category: string | undefined,
  policy: Awaited<ReturnType<typeof effectiveQuizPolicy>> | undefined,
): Promise<string | undefined> {
  if (!policy) return 'the community has no quiz policy';
  if (!policy.enabled) return 'automatic quizzes are disabled for this community';
  if (text.trim().length < policy.minimumPostLength) return `the post is shorter than ${policy.minimumPostLength} characters`;
  if (policy.categoriesAllowed.length > 0 && (!category || !policy.categoriesAllowed.includes(category))) {
    return 'the post category is not in the allowed list';
  }
  const since = new Date(ctx.now().getTime() - 86_400_000);
  const today = await ctx.prisma.quiz.count({ where: { communityId, createdAt: { gte: since } } });
  if (today >= policy.dailyQuizLimit) return `the daily limit of ${policy.dailyQuizLimit} quizzes is reached`;
  return undefined;
}

export async function listContent(ctx: AppContext, communityId: string, limit = 30) {
  return ctx.prisma.contentItem.findMany({
    where: { communityId },
    include: { quizzes: { select: { id: true, status: true, title: true } } },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
}
