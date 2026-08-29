'use client';

import Link from 'next/link';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { formatTon } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/use-api';

interface Home {
  balance: { total: string };
  communities: { communityId: string; communityName: string; learningPoints: number }[];
  learningPoints: number;
  quizzesCompleted: number;
  communitiesJoined: number;
}

/** Learning level is a platform-wide view of activity, separate from per-community loyalty. */
const LEVELS = [
  { key: 'Curious', minPoints: 0 },
  { key: 'Explorer', minPoints: 100 },
  { key: 'Researcher', minPoints: 500 },
  { key: 'Scientist', minPoints: 2000 },
  { key: 'Expert', minPoints: 5000 },
];

function levelFor(points: number) {
  return [...LEVELS].reverse().find((level) => points >= level.minPoints) ?? LEVELS[0]!;
}

function ProfileContent() {
  const { user, signOut } = useSession();
  const { data, error, loading } = useApi<Home>('/api/v1/me/home');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice message={error} />;
  if (!data || !user) return null;

  const level = levelFor(data.learningPoints);
  const next = LEVELS.find((candidate) => candidate.minPoints > data.learningPoints);

  return (
    <>
      <div className="card center">
        <div className="amount" style={{ fontSize: 26, fontWeight: 650 }}>
          {level.key}
        </div>
        <div className="muted small">
          {data.learningPoints} learning points
          {next ? ` · ${next.minPoints - data.learningPoints} to ${next.key}` : ' · top level'}
        </div>
      </div>

      <div className="stat-row mb">
        <div className="stat">
          <div className="value">{data.quizzesCompleted}</div>
          <div className="label">Quizzes</div>
        </div>
        <div className="stat">
          <div className="value">{data.communitiesJoined}</div>
          <div className="label">Communities</div>
        </div>
        <div className="stat">
          <div className="value">{formatTon(data.balance.total, 2)}</div>
          <div className="label">TON earned</div>
        </div>
      </div>

      <div className="card">
        <h2>Account</h2>
        <div className="row">
          <div className="secondary">Telegram</div>
          <div className="value">{user.username ? `@${user.username}` : user.telegramId}</div>
        </div>
        <div className="row">
          <div className="secondary">Referral code</div>
          <div className="value mono">{user.referralCode}</div>
        </div>
        <div className="row">
          <div className="secondary">Role</div>
          <div className="value">{user.isPlatformAdmin ? 'Platform admin' : user.isCreator ? 'Creator' : 'Learner'}</div>
        </div>
      </div>

      <div className="stack">
        <Link href="/invite" className="btn secondary">
          Invite friends
        </Link>
        {user.isCreator ? (
          <Link href="/creator" className="btn secondary">
            Creator dashboard
          </Link>
        ) : null}
        {user.isPlatformAdmin ? (
          <Link href="/admin" className="btn secondary">
            Platform administration
          </Link>
        ) : null}
        <button type="button" className="btn secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </>
  );
}

export default function ProfilePage() {
  return (
    <main className="app">
      <PageHeader title="Profile" subtitle="Your CLE activity across every community" />
      <RequireSession>
        <ProfileContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
