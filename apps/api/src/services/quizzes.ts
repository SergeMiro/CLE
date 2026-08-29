import { QuizGenerationError, generateQuiz } from '@cle/ai';
import { daysBetween, scoreQuizAttempt, streakMultiplierBps } from '@cle/core';
import type { Quiz } from '@cle/db';
import { encodeStartPayload, miniAppLink } from '@cle/telegram';
import type { AppContext } from '../context.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { recordAudit } from './audit.js';
import { effectiveQuizPolicy } from './policies.js';
import { type Actor, requireCommunityAccess } from './rbac.js';

export interface GenerateQuizResult {
  quiz: Quiz;
  qualityScore: number;
  issues: string[];
  autoPublishable: boolean;
}

/**
 * Runs the AI pipeline for one post and stores the result as a DRAFT (or
 * REVIEW, when the quality gate fails). Nothing is sent to the channel here.
 */
export async function generateQuizForContent(ctx: AppContext, contentItemId: string): Promise<GenerateQuizResult> {
  const content = await ctx.prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { community: { select: { id: true, organizationId: true, language: true } } },
  });
  if (!content) throw notFound('content item not found');
  const policy = await effectiveQuizPolicy(ctx, content.communityId);

  const previous = await ctx.prisma.quizQuestion.findMany({
    where: { quiz: { communityId: content.communityId } },
    select: { prompt: true },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });

  let generated;
  try {
    generated = await generateQuiz(ctx.ai, {
      content: {
        id: content.id,
        text: content.text,
        ...(content.language ? { language: content.language } : {}),
        ...(content.category ? { category: content.category } : {}),
      },
      policy: {
        questionsPerQuiz: policy.questionsPerQuiz,
        difficulty: policy.difficulty,
        language: policy.language,
        minimumPostLength: policy.minimumPostLength,
        qualityThreshold: policy.qualityThreshold,
        pointsPerQuestion: policy.pointsPerQuestion,
      },
      existingPrompts: previous.map((question) => question.prompt),
    });
  } catch (error) {
    await ctx.prisma.contentItem.update({
      where: { id: content.id },
      data: { status: 'FAILED', skipReason: error instanceof QuizGenerationError ? error.message : String(error) },
    });
    throw error instanceof QuizGenerationError ? unprocessable(error.message) : error;
  }

  await ctx.prisma.aIUsage.create({
    data: {
      organizationId: content.community.organizationId,
      communityId: content.communityId,
      provider: generated.provider,
      model: generated.model,
      operation: 'quiz.generate',
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
      estimatedCostMicroUsd: generated.estimatedCostMicroUsd,
      succeeded: true,
    },
  });

  const quiz = await ctx.prisma.quiz.create({
    data: {
      communityId: content.communityId,
      contentItemId: content.id,
      title: generated.quiz.title,
      status: generated.quality.passed ? 'DRAFT' : 'REVIEW',
      difficulty: policy.difficulty,
      language: generated.language,
      totalPoints: generated.totalPoints,
      qualityScore: generated.quality.score,
      generationMeta: {
        provider: generated.provider,
        model: generated.model,
        usage: generated.usage,
        issues: generated.quality.issues,
      } as never,
      questions: {
        create: generated.quiz.questions.map((question, questionIndex) => ({
          prompt: question.prompt,
          difficulty: policy.difficulty,
          basePoints: policy.pointsPerQuestion,
          sortOrder: questionIndex,
          options: {
            create: question.options.map((option, optionIndex) => ({
              text: option.text,
              isCorrect: option.isCorrect,
              explanation: option.explanation ?? null,
              sortOrder: optionIndex,
            })),
          },
        })),
      },
    },
  });

  await ctx.prisma.contentItem.update({ where: { id: content.id }, data: { status: 'QUIZ_READY' } });

  return {
    quiz,
    qualityScore: generated.quality.score,
    issues: generated.quality.issues.map((issue) => issue.message),
    autoPublishable: generated.quality.passed && policy.mode === 'AUTO',
  };
}

export async function approveQuiz(ctx: AppContext, actor: Actor, quizId: string): Promise<Quiz> {
  const quiz = await ctx.prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz) throw notFound('quiz not found');
  await requireCommunityAccess(ctx, actor, quiz.communityId, 'quiz:manage');
  if (quiz.status === 'PUBLISHED') throw conflict('this quiz is already published');
  return ctx.prisma.quiz.update({ where: { id: quizId }, data: { status: 'APPROVED', approvedAt: ctx.now() } });
}

interface Announcement {
  headline: string;
  questions: (count: number) => string;
  reward: (points: number) => string;
}

const ANNOUNCEMENTS: Record<string, Announcement> = {
  en: {
    headline: 'TEST YOUR KNOWLEDGE',
    questions: (count) => `${count} question${count === 1 ? '' : 's'} about the post above.`,
    reward: (points) => `Earn up to ${points} CLE learning points.`,
  },
  ru: {
    headline: 'ПРОВЕРЬ СЕБЯ',
    questions: (count) => `${count} ${count === 1 ? 'вопрос' : count < 5 ? 'вопроса' : 'вопросов'} по посту выше.`,
    reward: (points) => `Можно заработать до ${points} очков обучения CLE.`,
  },
  uk: {
    headline: 'ПЕРЕВІР СЕБЕ',
    questions: (count) => `${count} ${count === 1 ? 'питання' : 'питань'} за постом вище.`,
    reward: (points) => `Можна заробити до ${points} балів навчання CLE.`,
  },
};

export function announcementFor(language: string): Announcement {
  return ANNOUNCEMENTS[language.slice(0, 2).toLowerCase()] ?? ANNOUNCEMENTS.en!;
}

export interface PublishResult {
  quiz: Quiz;
  messageId: number | undefined;
  link: string;
}

/** Posts the call-to-action into the channel and opens the quiz for members. */
export async function publishQuiz(ctx: AppContext, quizId: string, actor?: Actor): Promise<PublishResult> {
  const quiz = await ctx.prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      community: { include: { channel: { select: { telegramChatId: true, status: true } } } },
      _count: { select: { questions: true } },
    },
  });
  if (!quiz) throw notFound('quiz not found');
  if (actor) await requireCommunityAccess(ctx, actor, quiz.communityId, 'quiz:manage');
  if (quiz.status === 'PUBLISHED') return { quiz, messageId: Number(quiz.publishedMessageId ?? 0) || undefined, link: quizLink(ctx, quiz.id) };
  if (quiz.status === 'REJECTED') throw unprocessable('a rejected quiz cannot be published');
  if (quiz.community.channel.status !== 'ACTIVE') throw unprocessable('the channel is not active, so CLE cannot post to it');

  const policy = await effectiveQuizPolicy(ctx, quiz.communityId);
  const link = quizLink(ctx, quiz.id);
  const announcement = announcementFor(quiz.language);
  const text = [
    announcement.headline,
    '',
    announcement.questions(quiz._count.questions),
    announcement.reward(quiz.totalPoints),
  ].join('\n');

  const message = await ctx.telegram.sendMessage({
    chatId: Number(quiz.community.channel.telegramChatId),
    text,
    disableWebPagePreview: true,
    replyMarkup: { inline_keyboard: [[{ text: policy.publishButtonText, url: link }]] },
  });

  const published = await ctx.prisma.quiz.update({
    where: { id: quizId },
    data: {
      status: 'PUBLISHED',
      publishedAt: ctx.now(),
      availableFrom: ctx.now(),
      publishedMessageId: BigInt(message.message_id),
    },
  });
  await recordAudit(ctx, {
    actorType: actor ? 'USER' : 'SYSTEM',
    actorId: actor?.id ?? null,
    action: 'quiz.published',
    entityType: 'Quiz',
    entityId: quizId,
    after: { messageId: message.message_id },
  });
  return { quiz: published, messageId: message.message_id, link };
}

export function quizLink(ctx: AppContext, quizId: string): string {
  const botUsername = ctx.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername) return `${ctx.env.MINI_APP_URL}/quiz/${quizId}`;
  return miniAppLink({ botUsername, appName: 'app', payload: { kind: 'quiz', quizId } });
}

export function quizStartPayload(quizId: string): string {
  return encodeStartPayload({ kind: 'quiz', quizId });
}

export interface QuizForMember {
  id: string;
  title: string;
  totalPoints: number;
  language: string;
  communityId: string;
  communityName: string;
  attemptStatus: 'AVAILABLE' | 'SUBMITTED';
  earnedPoints?: number;
  questions: { id: string; prompt: string; basePoints: number; options: { id: string; text: string }[] }[];
}

/** The answer key never leaves the server while an attempt is open. */
export async function getQuizForMember(ctx: AppContext, userId: string, quizId: string): Promise<QuizForMember> {
  const quiz = await ctx.prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      community: { select: { id: true, name: true } },
      questions: { include: { options: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!quiz) throw notFound('quiz not found');
  if (quiz.status !== 'PUBLISHED') throw notFound('quiz not found');

  const attempt = await ctx.prisma.quizAttempt.findUnique({ where: { quizId_userId: { quizId, userId } } });
  return {
    id: quiz.id,
    title: quiz.title,
    totalPoints: quiz.totalPoints,
    language: quiz.language,
    communityId: quiz.communityId,
    communityName: quiz.community.name,
    attemptStatus: attempt?.status === 'SUBMITTED' ? 'SUBMITTED' : 'AVAILABLE',
    ...(attempt?.status === 'SUBMITTED' ? { earnedPoints: attempt.finalPoints } : {}),
    questions: quiz.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      basePoints: question.basePoints,
      options: question.options.map((option) => ({ id: option.id, text: option.text })),
    })),
  };
}

export interface SubmitAnswer {
  questionId: string;
  optionId: string;
}

export interface QuizResult {
  correctCount: number;
  questionCount: number;
  rawPoints: number;
  finalPoints: number;
  multiplierBps: number;
  totalCommunityPoints: number;
  review: { questionId: string; correctOptionId: string; selectedOptionId: string; isCorrect: boolean; explanation: string | null }[];
}

/**
 * Scores an attempt on the server from the stored answer key. A member must be
 * in the channel to earn points, and each quiz can only be answered once.
 */
export async function submitQuizAttempt(ctx: AppContext, userId: string, quizId: string, answers: SubmitAnswer[]): Promise<QuizResult> {
  const quiz = await ctx.prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: { include: { options: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!quiz || quiz.status !== 'PUBLISHED') throw notFound('quiz not found');
  if (quiz.availableUntil && quiz.availableUntil < ctx.now()) throw unprocessable('this quiz is closed');

  const member = await ctx.prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId: quiz.communityId, userId } },
  });
  if (!member || (member.status !== 'ACTIVE' && member.status !== 'REJOIN_COOLDOWN')) {
    throw forbidden('join the channel to earn learning points');
  }

  const existing = await ctx.prisma.quizAttempt.findUnique({ where: { quizId_userId: { quizId, userId } } });
  if (existing?.status === 'SUBMITTED') throw conflict('you have already completed this quiz');

  const byQuestion = new Map(quiz.questions.map((question) => [question.id, question]));
  if (answers.length !== quiz.questions.length) throw badRequest('answer every question before submitting');
  const seen = new Set<string>();
  for (const answer of answers) {
    const question = byQuestion.get(answer.questionId);
    if (!question) throw badRequest('unknown question');
    if (seen.has(answer.questionId)) throw badRequest('a question was answered twice');
    seen.add(answer.questionId);
    if (!question.options.some((option) => option.id === answer.optionId)) throw badRequest('that option does not belong to the question');
  }

  const graded = answers.map((answer) => {
    const question = byQuestion.get(answer.questionId)!;
    const selected = question.options.find((option) => option.id === answer.optionId)!;
    const correct = question.options.find((option) => option.isCorrect)!;
    return { question, selected, correct, isCorrect: selected.isCorrect };
  });

  const streakDays = member.lastQuizAt ? Math.max(0, 7 - daysBetween(member.lastQuizAt, ctx.now())) : 0;
  const multiplierBps = streakMultiplierBps(streakDays);
  const score = scoreQuizAttempt({
    answers: graded.map((entry) => ({ basePoints: entry.question.basePoints, isCorrect: entry.isCorrect })),
    multiplierBps,
  });

  const totalCommunityPoints = await ctx.prisma.$transaction(async (tx) => {
    const attempt = await tx.quizAttempt.upsert({
      where: { quizId_userId: { quizId, userId } },
      create: {
        quizId,
        userId,
        communityId: quiz.communityId,
        status: 'SUBMITTED',
        idempotencyKey: `${quizId}:${userId}`,
        rawPoints: score.rawPoints,
        finalPoints: score.finalPoints,
        correctCount: score.correctCount,
        questionCount: score.questionCount,
        submittedAt: ctx.now(),
      },
      update: {
        status: 'SUBMITTED',
        rawPoints: score.rawPoints,
        finalPoints: score.finalPoints,
        correctCount: score.correctCount,
        questionCount: score.questionCount,
        submittedAt: ctx.now(),
      },
    });
    await tx.quizAnswer.createMany({
      data: graded.map((entry) => ({
        attemptId: attempt.id,
        questionId: entry.question.id,
        selectedOptionId: entry.selected.id,
        isCorrect: entry.isCorrect,
        pointsAwarded: entry.isCorrect ? entry.question.basePoints : 0,
      })),
      skipDuplicates: true,
    });
    const updatedMember = await tx.communityMember.update({
      where: { id: member.id },
      data: {
        learningPoints: { increment: score.finalPoints },
        quizzesCompleted: { increment: 1 },
        lastQuizAt: ctx.now(),
      },
    });
    await tx.user.update({ where: { id: userId }, data: { learningPoints: { increment: score.finalPoints } } });
    return updatedMember.learningPoints;
  });

  return {
    correctCount: score.correctCount,
    questionCount: score.questionCount,
    rawPoints: score.rawPoints,
    finalPoints: score.finalPoints,
    multiplierBps,
    totalCommunityPoints,
    review: graded.map((entry) => ({
      questionId: entry.question.id,
      correctOptionId: entry.correct.id,
      selectedOptionId: entry.selected.id,
      isCorrect: entry.isCorrect,
      explanation: entry.correct.explanation,
    })),
  };
}

/** The member's learning feed: published quizzes from every community they belong to. */
export async function listAvailableQuizzes(ctx: AppContext, userId: string, communityId?: string) {
  const memberships = await ctx.prisma.communityMember.findMany({
    where: { userId, status: { in: ['ACTIVE', 'REJOIN_COOLDOWN'] }, ...(communityId ? { communityId } : {}) },
    select: { communityId: true },
  });
  const communityIds = memberships.map((membership) => membership.communityId);
  if (communityIds.length === 0) return [];

  const quizzes = await ctx.prisma.quiz.findMany({
    where: {
      communityId: { in: communityIds },
      status: 'PUBLISHED',
      OR: [{ availableUntil: null }, { availableUntil: { gte: ctx.now() } }],
    },
    include: {
      community: { select: { id: true, name: true, slug: true } },
      attempts: { where: { userId }, select: { status: true, finalPoints: true } },
      _count: { select: { questions: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: 50,
  });

  return quizzes.map((quiz) => ({
    id: quiz.id,
    title: quiz.title,
    totalPoints: quiz.totalPoints,
    questionCount: quiz._count.questions,
    publishedAt: quiz.publishedAt,
    community: quiz.community,
    completed: quiz.attempts[0]?.status === 'SUBMITTED',
    earnedPoints: quiz.attempts[0]?.finalPoints ?? 0,
  }));
}
