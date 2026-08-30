'use client';

import Link from 'next/link';
import { BottomNav, Empty, ErrorNotice, Loading, PageHeader, RequireSession } from '../components/shell';
import { BoltIcon, ChevronIcon, CommunitiesIcon } from '../components/icons';
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

  if (loading && !data) return <Loading hero rows={2} />;
  if (error) return <ErrorNotice message={error} />;
  if (!data) return null;

  const pending = BigInt(data.balance.pending);
  const locked = BigInt(data.balance.locked);

  return (
    <>
      <section className="hero">
        <div className="eyebrow">Available to withdraw</div>
        <div className="amount">
          {formatTon(data.balance.available)}
          <span className="unit">TON</span>
        </div>
        <div className="chips">
          {pending > 0n ? <span className="chip">{formatTon(pending, 2)} pending release</span> : null}
          {locked > 0n ? <span className="chip">{formatTon(locked, 2)} locked</span> : null}
          <span className="chip">{formatTon(data.balance.total, 2)} earned in total</span>
        </div>
      </section>

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
        <Link href="/learn" className="card tight spread">
          <div className="with-badge">
            <span className="mono-badge">
              <BoltIcon width={19} height={19} />
            </span>
            <div>
              <div className="primary">
                {data.openQuizzes} quiz{data.openQuizzes === 1 ? '' : 'zes'} waiting
              </div>
              <div className="secondary">Answer them to earn a share of the learning pool</div>
            </div>
          </div>
          <ChevronIcon className="chevron" />
        </Link>
      ) : null}

      <div className="section-title">Your communities</div>
      {data.communities.length === 0 ? (
        <Empty icon={<CommunitiesIcon width={26} height={26} />}>
          You are not in a CLE community yet. Join a channel that runs on CLE and it will appear here.
        </Empty>
      ) : (
        <div className="card flush">
          {data.communities.map((community) => (
            <Link key={community.communityId} href={`/communities/${community.communitySlug}`} className="row">
              <div className="with-badge">
                <span className="mono-badge">{community.communityName.slice(0, 1).toUpperCase()}</span>
                <div>
                  <div className="primary truncate">{community.communityName}</div>
                  <div className="secondary">
                    {community.learningPoints} points · {community.status.toLowerCase().replace('_', ' ')}
                  </div>
                </div>
              </div>
              <div className="value">
                <div>{formatTon(community.availableNanoton)} TON</div>
                {BigInt(community.pendingNanoton) > 0n ? (
                  <div className="secondary">+{formatTon(community.pendingNanoton)} pending</div>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}

      {user?.isCreator || user?.isPlatformAdmin ? (
        <div className="stack mt">
          {user?.isCreator ? (
            <Link href="/creator" className="btn secondary">
              Creator dashboard
            </Link>
          ) : null}
          {user?.isPlatformAdmin ? (
            <Link href="/admin" className="btn secondary">
              Platform administration
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export default function HomePage() {
  const { user } = useSession();
  const greeting = user?.firstName ?? user?.username;
  return (
    <main className="app">
      <PageHeader title={greeting ? `Hi, ${greeting}` : 'CLE'} subtitle="Create, Learn & Earn — your share of what the channels you follow make" />
      <RequireSession>
        <HomeContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
