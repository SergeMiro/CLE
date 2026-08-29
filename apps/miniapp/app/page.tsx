'use client';

import Link from 'next/link';
import { BottomNav, Empty, ErrorNotice, Loading, PageHeader, RequireSession } from '../components/shell';
import { formatTon } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi } from '../lib/use-api';

interface CommunityBreakdown {
  communityId: string;
  communityName: string;
  communitySlug: string;
  availableNanoton: string;
  pendingNanoton: string;
  learningPoints: number;
  status: string;
}

interface Home {
  balance: { available: string; pending: string; locked: string; total: string };
  communities: CommunityBreakdown[];
  learningPoints: number;
  quizzesCompleted: number;
  communitiesJoined: number;
  openQuizzes: number;
}

function HomeContent() {
  const { user } = useSession();
  const { data, error, loading } = useApi<Home>('/api/v1/me/home');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="card balance">
        <div className="amount">
          {formatTon(data.balance.available)}
          <span>TON</span>
        </div>
        <div className="caption">Available to withdraw</div>
        {BigInt(data.balance.pending) > 0n ? (
          <div className="caption">{formatTon(data.balance.pending)} TON pending release</div>
        ) : null}
      </div>

      <div className="stat-row mb">
        <div className="stat">
          <div className="value">{data.learningPoints}</div>
          <div className="label">Learning points</div>
        </div>
        <div className="stat">
          <div className="value">{data.quizzesCompleted}</div>
          <div className="label">Quizzes done</div>
        </div>
        <div className="stat">
          <div className="value">{data.communitiesJoined}</div>
          <div className="label">Communities</div>
        </div>
      </div>

      {data.openQuizzes > 0 ? (
        <Link href="/learn" className="card tight spread" style={{ display: 'flex' }}>
          <div>
            <div className="primary">
              {data.openQuizzes} quiz{data.openQuizzes === 1 ? '' : 'zes'} waiting
            </div>
            <div className="secondary muted">Answer them to earn a share of the learning pool</div>
          </div>
          <span aria-hidden>→</span>
        </Link>
      ) : null}

      <div className="card">
        <h2>Your communities</h2>
        {data.communities.length === 0 ? (
          <p className="muted small">
            You are not in a CLE community yet. Join a channel that runs on CLE and it will appear here.
          </p>
        ) : (
          data.communities.map((community) => (
            <Link key={community.communityId} href={`/communities/${community.communitySlug}`} className="row">
              <div>
                <div className="primary">{community.communityName}</div>
                <div className="secondary">
                  {community.learningPoints} points · {community.status.toLowerCase().replace('_', ' ')}
                </div>
              </div>
              <div className="value">
                <div>{formatTon(community.availableNanoton)} TON</div>
                {BigInt(community.pendingNanoton) > 0n ? (
                  <div className="secondary">+{formatTon(community.pendingNanoton)} pending</div>
                ) : null}
              </div>
            </Link>
          ))
        )}
      </div>

      {user?.isCreator ? (
        <Link href="/creator" className="btn secondary mb">
          Creator dashboard
        </Link>
      ) : null}
      {user?.isPlatformAdmin ? (
        <Link href="/admin" className="btn secondary">
          Platform administration
        </Link>
      ) : null}
    </>
  );
}

export default function HomePage() {
  const { user } = useSession();
  return (
    <main className="app">
      <PageHeader title="CLE" subtitle={user ? `Create, Learn & Earn · ${user.firstName ?? user.username ?? 'member'}` : 'Create, Learn & Earn'} />
      <RequireSession>
        <HomeContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
