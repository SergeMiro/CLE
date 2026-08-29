import { AIProviderError, type AIProvider, type AIUsage, estimateCostMicroUsd, type CostModel } from './provider.js';
import { type QualityReport, assessQuiz } from './quality.js';
import { type GeneratedQuiz, QuizSchemaError, parseGeneratedQuiz } from './quiz-schema.js';

export interface QuizGenerationPolicy {
  questionsPerQuiz: number;
  difficulty: 'EASY' | 'NORMAL' | 'HARD' | 'CHALLENGE';
  language: string;
  minimumPostLength: number;
  qualityThreshold: number;
  pointsPerQuestion: number;
}

export interface ContentInput {
  id: string;
  text: string;
  /** Optional hint; when absent the language is detected from the text. */
  language?: string;
  category?: string;
  sourceUrl?: string;
}

export interface QuizGenerationRequest {
  content: ContentInput;
  policy: QuizGenerationPolicy;
  existingPrompts?: readonly string[];
  costModel?: CostModel;
}

export interface QuizGenerationResult {
  quiz: GeneratedQuiz;
  quality: QualityReport;
  usage: AIUsage;
  provider: string;
  model: string;
  estimatedCostMicroUsd: number;
  language: string;
  totalPoints: number;
}

export class QuizGenerationError extends Error {
  constructor(message: string, readonly reason: 'too_short' | 'provider' | 'schema') {
    super(message);
  }
}

const SYSTEM_PROMPT = [
  'You write multiple-choice comprehension quizzes about a single social-media post.',
  'Rules you must follow:',
  '- Every question must be answerable from the post alone, with no outside knowledge.',
  '- Exactly one option per question is correct.',
  '- Distractors must be plausible and of a similar length to the correct answer.',
  '- Every option carries a one-sentence explanation.',
  '- Never mention that you are an AI, and never reference "the text" as a source of authority beyond the post.',
  'Reply with a single JSON object and nothing else:',
  '{"title": string, "language": string, "questions": [{"prompt": string, "options": [{"text": string, "isCorrect": boolean, "explanation": string}]}]}',
].join('\n');

const LANGUAGE_PATTERNS: [string, RegExp][] = [
  ['ru', /[Ѐ-ӿ]/],
  ['zh', /[一-鿿]/],
  ['ar', /[؀-ۿ]/],
  ['fr', /\b(le|la|les|des|est|une|dans|pour|avec)\b/i],
  ['es', /\b(el|los|las|una|para|con|que|por)\b/i],
  ['de', /\b(der|die|das|und|nicht|mit|für)\b/i],
];

/** Cheap script and stop-word detection; good enough to pick a prompt language. */
export function detectLanguage(text: string, fallback = 'en'): string {
  for (const [language, pattern] of LANGUAGE_PATTERNS) if (pattern.test(text)) return language;
  return fallback;
}

/** Strips the noise a Telegram post carries so the model reads the substance. */
export function normaliseContent(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@][\p{L}\p{N}_]+/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPrompt(content: ContentInput, policy: QuizGenerationPolicy, language: string): string {
  return [
    `<language>${language}</language>`,
    `<questions>${policy.questionsPerQuiz}</questions>`,
    `<difficulty>${policy.difficulty}</difficulty>`,
    content.category ? `<category>${content.category}</category>` : '',
    `<content>${normaliseContent(content.text)}</content>`,
    `Write ${policy.questionsPerQuiz} ${policy.difficulty.toLowerCase()} questions in ${language} about the post above.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * content -> language detection -> normalisation -> generation -> schema
 * validation -> quality assessment. Nothing is written to the channel here;
 * the caller decides what to do with a quiz that fails the quality gate.
 */
export async function generateQuiz(provider: AIProvider, request: QuizGenerationRequest): Promise<QuizGenerationResult> {
  const { content, policy } = request;
  const cleaned = normaliseContent(content.text);
  if (cleaned.length < policy.minimumPostLength) {
    throw new QuizGenerationError(
      `post ${content.id} is ${cleaned.length} characters, below the ${policy.minimumPostLength} character minimum`,
      'too_short',
    );
  }

  const language = content.language ?? detectLanguage(cleaned, policy.language);
  let completion;
  try {
    completion = await provider.complete({ system: SYSTEM_PROMPT, prompt: buildPrompt(content, policy, language) });
  } catch (error) {
    throw new QuizGenerationError(
      error instanceof AIProviderError ? error.message : String(error),
      'provider',
    );
  }

  let quiz: GeneratedQuiz;
  try {
    quiz = parseGeneratedQuiz(completion.text);
  } catch (error) {
    throw new QuizGenerationError(error instanceof QuizSchemaError ? error.message : String(error), 'schema');
  }

  const quality = assessQuiz(quiz, {
    expectedQuestions: policy.questionsPerQuiz,
    threshold: policy.qualityThreshold,
    ...(request.existingPrompts ? { existingPrompts: request.existingPrompts } : {}),
    sourceText: cleaned,
  });

  return {
    quiz,
    quality,
    usage: completion.usage,
    provider: completion.provider,
    model: completion.model,
    estimatedCostMicroUsd: request.costModel ? estimateCostMicroUsd(completion.usage, request.costModel) : 0,
    language: quiz.language ?? language,
    totalPoints: quiz.questions.length * policy.pointsPerQuestion,
  };
}
