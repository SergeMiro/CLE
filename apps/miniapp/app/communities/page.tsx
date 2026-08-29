'use client';

import Link from 'next/link';
import { BottomNav, Empty, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { formatDate } from '../../lib/format';
import { useApi } from '../../lib/use-api';

interface Membership {
  membershipId: string;
  status: string;
  learningPoints: number;
  quizzesCompleted: number;
  level: string | null;
  joinedAt: string | null;
  community: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    memberCount: number;
    channel: { username: string | null; title: string };
  };
}

const STATUS_PILL: Record<string, string> = {
  ACTIVE: 'ok',
  REJOIN_COOLDOWN: 'warn',
  LEFT: 'neutral',
  BANNED: 'bad',
  UNKNOWN: 'neutral',
};

function CommunitiesContent() {
  const { data, error, loading } = useApi<Membership[]>('/api/v1/me/communities');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice message={error} />;
  if (!data) return null;
  if (data.length === 0) return <Empty>Join a channel that runs on CLE and it will show up here.</Empty>;

  return (
    <>
      {data.map((membership) => (
        <Link key={membership.membershipId} href={`/communities/${membership.community.slug}`} className="card">
          <div className="spread">
            <div>
              <div className="primary">{membership.community.name}</div>
              <div className="secondary muted">
                {membership.community.channel.username ? `@${membership.community.channel.username}` : membership.community.channel.title}
                {' · '}
                {membership.community.memberCount} members
              </div>
            </div>
            <span className={`pill ${STATUS_PILL[membership.status] ?? 'neutral'}`}>{membership.status.replace('_', ' ')}</span>
          </div>
          <div className="row mt">
            <div className="secondary">Learning points</div>
            <div className="value">{membership.learningPoints}</div>
          </div>
          <div className="row">
            <div className="secondary">Quizzes completed</div>
            <div className="value">{membership.quizzesCompleted}</div>
          </div>
          <div className="row">
            <div className="secondary">Member since</div>
            <div className="value">{formatDate(membership.joinedAt)}</div>
          </div>
        </Link>
      ))}
    </>
  );
}

export default function CommunitiesPage() {
  return (
    <main className="app">
      <PageHeader title="Communities" subtitle="Every CLE community you belong to" />
      <RequireSession>
        <CommunitiesContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
