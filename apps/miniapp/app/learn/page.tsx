'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BottomNav, Empty, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { formatDate } from '../../lib/format';
import { useApi } from '../../lib/use-api';

interface QuizSummary {
  id: string;
  title: string;
  totalPoints: number;
  questionCount: number;
  publishedAt: string | null;
  community: { id: string; name: string; slug: string };
  completed: boolean;
  earnedPoints: number;
}

function LearnContent() {
  const { data, error, loading } = useApi<QuizSummary[]>('/api/v1/me/quizzes');
  const [filter, setFilter] = useState<string>('all');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice message={error} />;
  if (!data) return null;
  if (data.length === 0) {
    return <Empty>No quizzes yet. When a channel you follow posts, its quiz appears here.</Empty>;
  }

  const communities = [...new Map(data.map((quiz) => [quiz.community.id, quiz.community])).values()];
  const visible = filter === 'all' ? data : data.filter((quiz) => quiz.community.id === filter);

  return (
    <>
      {communities.length > 1 ? (
        <div className="tabs">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All
          </button>
          {communities.map((community) => (
            <button
              key={community.id}
              type="button"
              className={filter === community.id ? 'active' : ''}
              onClick={() => setFilter(community.id)}
            >
              {community.name}
            </button>
          ))}
        </div>
      ) : null}

      {visible.map((quiz) => (
        <Link key={quiz.id} href={`/quiz/${quiz.id}`} className="card tight spread" style={{ display: 'flex' }}>
          <div>
            <div className="primary">{quiz.title}</div>
            <div className="secondary muted">
              {quiz.community.name} · {quiz.questionCount} questions · {formatDate(quiz.publishedAt)}
            </div>
          </div>
          {quiz.completed ? (
            <span className="pill ok">+{quiz.earnedPoints}</span>
          ) : (
            <span className="pill neutral">{quiz.totalPoints} pts</span>
          )}
        </Link>
      ))}
    </>
  );
}

export default function LearnPage() {
  return (
    <main className="app">
      <PageHeader title="Learn" subtitle="Quizzes from every community you belong to" />
      <RequireSession>
        <LearnContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
