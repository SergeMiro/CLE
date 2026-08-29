import type { GeneratedQuiz } from './quiz-schema.js';

export interface QualityIssue {
  code: string;
  message: string;
  /** How many points this costs out of 100. */
  penalty: number;
}

export interface QualityReport {
  score: number;
  issues: QualityIssue[];
  passed: boolean;
}

export interface QualityOptions {
  expectedQuestions: number;
  threshold: number;
  /** Question prompts already used in this community, to catch a repeated quiz. */
  existingPrompts?: readonly string[];
  /** Source post, used to check the quiz is actually about the content. */
  sourceText?: string;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function trigrams(text: string): Set<string> {
  const value = normalise(text);
  const result = new Set<string>();
  for (let index = 0; index + 3 <= value.length; index += 1) result.add(value.slice(index, index + 3));
  return result;
}

/** Jaccard similarity over character trigrams — cheap, language-agnostic, no dependencies. */
export function similarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Gate for AUTO mode: a quiz that fails here is held for the creator to review
 * instead of being published to the channel automatically.
 */
export function assessQuiz(quiz: GeneratedQuiz, options: QualityOptions): QualityReport {
  const issues: QualityIssue[] = [];

  if (quiz.questions.length !== options.expectedQuestions) {
    issues.push({
      code: 'question_count',
      message: `expected ${options.expectedQuestions} questions, received ${quiz.questions.length}`,
      penalty: 15,
    });
  }

  quiz.questions.forEach((question, index) => {
    const correct = question.options.filter((option) => option.isCorrect);
    if (correct.length !== 1) {
      issues.push({ code: 'answer_key', message: `question ${index + 1} has ${correct.length} correct options`, penalty: 40 });
    }
    if (question.options.length < 3) {
      issues.push({ code: 'too_few_options', message: `question ${index + 1} offers fewer than three options`, penalty: 10 });
    }
    const texts = question.options.map((option) => normalise(option.text));
    if (new Set(texts).size !== texts.length) {
      issues.push({ code: 'duplicate_options', message: `question ${index + 1} repeats an option`, penalty: 15 });
    }
    if (question.options.some((option) => !option.explanation)) {
      issues.push({ code: 'missing_explanation', message: `question ${index + 1} has an option without an explanation`, penalty: 5 });
    }
    // A correct answer that is much longer than every distractor is a giveaway.
    const correctOption = correct[0];
    if (correctOption) {
      const others = question.options.filter((option) => option !== correctOption);
      const longest = Math.max(0, ...others.map((option) => option.text.length));
      if (others.length > 0 && correctOption.text.length > longest * 2.5) {
        issues.push({ code: 'length_giveaway', message: `question ${index + 1} gives the answer away by length`, penalty: 10 });
      }
    }
  });

  const prompts = quiz.questions.map((question) => normalise(question.prompt));
  if (new Set(prompts).size !== prompts.length) {
    issues.push({ code: 'duplicate_questions', message: 'the quiz repeats a question', penalty: 20 });
  }

  for (const existing of options.existingPrompts ?? []) {
    const match = quiz.questions.find((question) => similarity(question.prompt, existing) > 0.8);
    if (match) {
      issues.push({ code: 'duplicate_of_previous', message: 'a question repeats an earlier quiz in this community', penalty: 25 });
      break;
    }
  }

  if (options.sourceText) {
    const source = new Set(normalise(options.sourceText).split(' ').filter((word) => word.length > 4));
    const grounded = quiz.questions.filter((question) =>
      normalise(question.prompt).split(' ').some((word) => source.has(word)),
    );
    if (grounded.length < quiz.questions.length / 2) {
      issues.push({ code: 'ungrounded', message: 'most questions do not reference the source post', penalty: 25 });
    }
  }

  const score = Math.max(0, 100 - issues.reduce((total, issue) => total + issue.penalty, 0));
  return { score, issues, passed: score >= options.threshold };
}
