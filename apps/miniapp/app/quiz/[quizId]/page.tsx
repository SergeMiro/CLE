'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../../components/shell';
import { CommunitiesIcon, SparkIcon } from '../../../components/icons';
import { api } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { haptic, openLink } from '../../../lib/telegram';
import { useApi } from '../../../lib/use-api';

interface QuizQuestion {
  id: string;
  prompt: string;
  basePoints: number;
  options: { id: string; text: string }[];
}

interface Quiz {
  id: string;
  title: string;
  totalPoints: number;
  communityName: string;
  attemptStatus: 'AVAILABLE' | 'SUBMITTED';
  earnedPoints?: number;
  membershipStatus: string;
  canAnswer: boolean;
  channelUsername: string | null;
  questions: QuizQuestion[];
}

interface QuizResult {
  correctCount: number;
  questionCount: number;
  finalPoints: number;
  multiplierBps: number;
  totalCommunityPoints: number;
  review: { questionId: string; correctOptionId: string; selectedOptionId: string; isCorrect: boolean; explanation: string | null }[];
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function QuizRunner({ quiz }: { quiz: Quiz }) {
  const { token } = useSession();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const answered = quiz.questions.filter((question) => answers[question.id]).length;
  const complete = answered === quiz.questions.length;

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    try {
      const payload = quiz.questions.map((question) => ({ questionId: question.id, optionId: answers[question.id]! }));
      const outcome = await api.post<QuizResult>(`/api/v1/quizzes/${quiz.id}/submit`, { answers: payload }, token);
      setResult(outcome);
      haptic(outcome.correctCount === outcome.questionCount ? 'success' : 'light');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      haptic('error');
    } finally {
      setSubmitting(false);
    }
  }

  const reviewFor = (questionId: string) => result?.review.find((entry) => entry.questionId === questionId);

  return (
    <>
      {result ? (
        <div className="card center">
          <div className="ring" style={{ ['--pct' as string]: (result.correctCount / result.questionCount) * 100 }}>
            <div>
              <b>
                {result.correctCount}/{result.questionCount}
              </b>
              <small>correct</small>
            </div>
          </div>
          <div className="pill brand" style={{ marginBottom: 6 }}>
            +{result.finalPoints} learning points
            {result.multiplierBps > 10_000 ? ` · streak ×${(result.multiplierBps / 10_000).toFixed(2)}` : ''}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {result.totalCommunityPoints} points in {quiz.communityName}
          </p>
        </div>
      ) : (
        <div className="card tight">
          <div className="spread" style={{ marginBottom: 9 }}>
            <div className="primary truncate">{quiz.title}</div>
            <span className="pill brand">{quiz.totalPoints} pts</span>
          </div>
          <div className="progress">
            <span style={{ width: `${(answered / quiz.questions.length) * 100}%` }} />
          </div>
          <div className="secondary muted" style={{ marginTop: 7 }}>
            {answered} of {quiz.questions.length} answered · {quiz.communityName}
          </div>
        </div>
      )}

      {error ? <ErrorNotice message={error} /> : null}

      {quiz.questions.map((question, index) => {
        const review = reviewFor(question.id);
        return (
          <div className="card" key={question.id}>
            <h3>
              <span className="muted" style={{ fontWeight: 600 }}>
                {index + 1}.{' '}
              </span>
              {question.prompt}
            </h3>
            {question.options.map((option, optionIndex) => {
              const selected = answers[question.id] === option.id;
              let className = 'quiz-option';
              if (review) {
                if (option.id === review.correctOptionId) className += ' correct';
                else if (option.id === review.selectedOptionId) className += ' wrong';
              } else if (selected) {
                className += ' selected';
              }
              return (
                <button
                  type="button"
                  key={option.id}
                  className={className}
                  disabled={Boolean(result)}
                  onClick={() => {
                    haptic('light');
                    setAnswers((current) => ({ ...current, [question.id]: option.id }));
                  }}
                >
                  <span className="key">{LETTERS[optionIndex] ?? optionIndex + 1}</span>
                  <span className="body">
                    {option.text}
                    {review && option.id === review.correctOptionId && review.explanation ? (
                      <span className="explanation">{review.explanation}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}

      {result ? (
        <button type="button" className="btn" onClick={() => router.push('/learn')}>
          Back to Learn
        </button>
      ) : (
        <button type="button" className="btn" disabled={!complete || submitting} onClick={submit}>
          {submitting ? 'Checking…' : complete ? 'Submit answers' : `Answer ${quiz.questions.length - answered} more`}
        </button>
      )}
    </>
  );
}

function QuizContent() {
  const params = useParams<{ quizId: string }>();
  const { data, error, loading } = useApi<Quiz>(params?.quizId ? `/api/v1/quizzes/${params.quizId}` : undefined);

  if (loading && !data) return <Loading rows={3} />;
  if (error) return <ErrorNotice message={error} />;
  if (!data) return null;
  if (!data.canAnswer) {
    // Answering without being in the channel earns nothing, so say that before
    // the questions rather than after the submission is refused.
    return (
      <div className="card empty">
        <div className="glyph">
          <CommunitiesIcon width={26} height={26} />
        </div>
        <h3 style={{ marginBottom: 6 }}>Join {data.communityName} first</h3>
        <p>Learning points are paid to members of the channel. Join it, then come back to this quiz.</p>
        {data.channelUsername ? (
          <button type="button" className="btn mt" onClick={() => openLink(`https://t.me/${data.channelUsername}`)}>
            Open the channel
          </button>
        ) : null}
      </div>
    );
  }

  if (data.attemptStatus === 'SUBMITTED') {
    return (
      <div className="card empty">
        <div className="glyph">
          <SparkIcon width={26} height={26} />
        </div>
        <h3 style={{ marginBottom: 6 }}>Already completed</h3>
        <p>You earned {data.earnedPoints} learning points from this quiz.</p>
      </div>
    );
  }
  return <QuizRunner quiz={data} />;
}

export default function QuizPage() {
  return (
    <main className="app">
      <PageHeader title="Quiz" subtitle="Questions written from the post · answers checked on the server" />
      <RequireSession>
        <QuizContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
