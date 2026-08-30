'use client';

import Link from 'next/link';
import { BottomNav, Empty, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { CommunitiesIcon } from '../../components/icons';
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
  if (data.length === 0) {
    return (
      <Empty icon={<CommunitiesIcon width={26} height={26} />}>
        Join a channel that runs on CLE and it will show up here.
      </Empty>
    );
  }

  return (
    <>
      {data.map((membership) => (
        <Link key={membership.membershipId} href={`/communities/${membership.community.slug}`} className="card">
          <div className="spread">
            <div className="with-badge">
              <span className="mono-badge">{membership.community.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <div className="primary truncate">{membership.community.name}</div>
                <div className="secondary truncate">
                  {membership.community.channel.username
                    ? `@${membership.community.channel.username}`
                    : membership.community.channel.title}
                  {' · '}
                  {membership.community.memberCount} members
                </div>
              </div>
            </div>
            <span className={`pill ${STATUS_PILL[membership.status] ?? 'neutral'}`}>{membership.status.replace('_', ' ')}</span>
          </div>
          <div className="facts">
            <div>
              <div className="value">{membership.learningPoints}</div>
              <div className="label">Points</div>
            </div>
            <div>
              <div className="value">{membership.quizzesCompleted}</div>
              <div className="label">Quizzes</div>
            </div>
            <div>
              <div className="value date">{formatDate(membership.joinedAt)}</div>
              <div className="label">Member since</div>
            </div>
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
