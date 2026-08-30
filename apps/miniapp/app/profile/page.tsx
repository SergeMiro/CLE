'use client';

import Link from 'next/link';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { Money } from '../../components/money';
import { useMoneyUnit } from '../../lib/money-unit';
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
  const { unit, setUnit } = useMoneyUnit();
  const { data, error, loading } = useApi<Home>('/api/v1/me/home');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice message={error} />;
  if (!data || !user) return null;

  const level = levelFor(data.learningPoints);
  const next = LEVELS.find((candidate) => candidate.minPoints > data.learningPoints);
  // How far along the current band the person is, so the bar means something
  // rather than filling from zero at every level.
  const progress = next
    ? Math.min(100, ((data.learningPoints - level.minPoints) / (next.minPoints - level.minPoints)) * 100)
    : 100;

  return (
    <>
      <section className="hero">
        <div className="eyebrow">Learning level</div>
        <div className="amount">
          {level.key}
          <span className="unit">{data.learningPoints} XP</span>
        </div>
        <div className="level-track">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="level-caption">
          {next ? `${next.minPoints - data.learningPoints} XP to ${next.key}` : 'Top level reached'}
        </div>
      </section>

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
          <div className="value"><Money nanoton={data.balance.total} tonFractionDigits={2} withUnit={false} /></div>
          <div className="label">{unit} earned</div>
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
        <div className="row">
          <div>
            <div className="secondary">Balances shown in</div>
            <div className="secondary muted small">1 000 CLEP = 1 TON, always</div>
          </div>
          <div className="segmented">
            {(['CLEP', 'TON'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={option === unit ? 'active' : ''}
                aria-pressed={option === unit}
                onClick={() => setUnit(option)}
              >
                {option}
              </button>
            ))}
          </div>
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
