import { describe, expect, it } from 'vitest';
import { MoneyError, scoreQuizAttempt, streakMultiplierBps } from '../src/index.js';

describe('scoreQuizAttempt', () => {
  it('awards points only for correct answers', () => {
    const score = scoreQuizAttempt({
      answers: [
        { basePoints: 10, isCorrect: true },
        { basePoints: 10, isCorrect: false },
        { basePoints: 20, isCorrect: true },
      ],
    });
    expect(score).toEqual({ rawPoints: 30, finalPoints: 30, correctCount: 2, questionCount: 3 });
  });

  it('applies the multiplier and floors the result', () => {
    const score = scoreQuizAttempt({ answers: [{ basePoints: 15, isCorrect: true }], multiplierBps: 12_500 });
    expect(score.finalPoints).toBe(18);
  });

  it('scores an empty attempt as zero', () => {
    expect(scoreQuizAttempt({ answers: [] }).finalPoints).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(() => scoreQuizAttempt({ answers: [{ basePoints: -1, isCorrect: true }] })).toThrow(MoneyError);
    expect(() => scoreQuizAttempt({ answers: [], multiplierBps: -1 })).toThrow(MoneyError);
  });
});

describe('streakMultiplierBps', () => {
  it('grows with the streak and stops at the cap', () => {
    expect(streakMultiplierBps(0)).toBe(10_000);
    expect(streakMultiplierBps(3)).toBe(11_500);
    expect(streakMultiplierBps(100)).toBe(15_000);
  });

  it('rejects a fractional streak', () => {
    expect(() => streakMultiplierBps(2.5)).toThrow(MoneyError);
  });
});
