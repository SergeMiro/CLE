import { MoneyError } from './money.js';

export interface QuizScoringInput {
  answers: readonly { basePoints: number; isCorrect: boolean }[];
  /** Streak or level bonus expressed in basis points; 10000 = no bonus. */
  multiplierBps?: number;
}

export interface QuizScore {
  rawPoints: number;
  finalPoints: number;
  correctCount: number;
  questionCount: number;
}

export function scoreQuizAttempt({ answers, multiplierBps = 10_000 }: QuizScoringInput): QuizScore {
  if (!Number.isInteger(multiplierBps) || multiplierBps < 0) throw new MoneyError('multiplierBps must be a non-negative integer');
  let rawPoints = 0;
  let correctCount = 0;
  for (const answer of answers) {
    if (!Number.isInteger(answer.basePoints) || answer.basePoints < 0) throw new MoneyError('basePoints must be a non-negative integer');
    if (answer.isCorrect) {
      rawPoints += answer.basePoints;
      correctCount += 1;
    }
  }
  return {
    rawPoints,
    finalPoints: Math.floor((rawPoints * multiplierBps) / 10_000),
    correctCount,
    questionCount: answers.length,
  };
}

/** A learning streak grows the multiplier, capped so a long streak cannot dominate a pool. */
export function streakMultiplierBps(streakDays: number, stepBps = 500, capBps = 15_000): number {
  if (!Number.isInteger(streakDays) || streakDays < 0) throw new MoneyError('streakDays must be a non-negative integer');
  return Math.min(capBps, 10_000 + streakDays * stepBps);
}
