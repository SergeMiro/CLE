'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../../components/shell';
import { CheckIcon } from '../../../components/icons';
import { api } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { openLink } from '../../../lib/telegram';
import { useApi } from '../../../lib/use-api';

interface CommunityDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  memberCount: number;
  status: string;
  channel: { title: string; username: string | null };
  membership: { status: string; learningPoints: number } | null;
}

function CommunityContent() {
  const params = useParams<{ slug: string }>();
  const { token } = useSession();
  const { data, error, loading, reload } = useApi<CommunityDetail>(params?.slug ? `/api/v1/communities/${params.slug}` : undefined);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const [syncMessage, setSyncMessage] = useState<string>();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice message={error} />;
  if (!data) return null;

  const inChannel = data.membership?.status === 'ACTIVE' || data.membership?.status === 'REJOIN_COOLDOWN';

  async function checkMembership() {
    if (!data) return;
    setSyncing(true);
    setSyncError(undefined);
    setSyncMessage(undefined);
    try {
      const result = await api.post<{ status: string; changed: boolean }>(
        `/api/v1/communities/${data.id}/membership/sync`,
        {},
        token,
      );
      setSyncMessage(
        result.status === 'ACTIVE'
          ? 'You are in the channel — rewards are on.'
          : result.status === 'REJOIN_COOLDOWN'
            ? 'Welcome back. Rewards resume after the rejoin cooldown.'
            : 'Telegram says you are not in the channel yet.',
      );
      reload();
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="with-badge mb">
          <span className="mono-badge">{data.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <div className="primary truncate" style={{ fontSize: 17 }}>
              {data.name}
            </div>
            <div className="secondary truncate">
              {data.channel.username ? `@${data.channel.username}` : data.channel.title}
            </div>
          </div>
          {inChannel ? (
            <span className="pill ok" style={{ marginLeft: 'auto' }}>
              <CheckIcon width={12} height={12} /> member
            </span>
          ) : null}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {data.description ?? 'A CLE community.'}
        </p>
        <div className="facts">
          <div>
            <div className="value">{data.memberCount}</div>
            <div className="label">Members</div>
          </div>
          <div>
            <div className="value">{data.membership?.learningPoints ?? 0}</div>
            <div className="label">Your XP</div>
          </div>
          <div>
            <div className="value date">{(data.membership?.status ?? 'not joined').toLowerCase().replace('_', ' ')}</div>
            <div className="label">Membership</div>
          </div>
        </div>
      </div>

      {syncError ? <ErrorNotice message={syncError} /> : null}
      {syncMessage ? <div className="notice ok">{syncMessage}</div> : null}

      {!inChannel && data.channel.username ? (
        <button type="button" className="btn mb" onClick={() => openLink(`https://t.me/${data.channel.username}`)}>
          Open the channel
        </button>
      ) : null}

      <button type="button" className="btn secondary" onClick={checkMembership} disabled={syncing}>
        {syncing ? 'Checking with Telegram…' : 'Check my membership'}
      </button>

      <Link href="/learn" className="btn secondary mt">
        See this community&apos;s quizzes
      </Link>
    </>
  );
}

export default function CommunityPage() {
  return (
    <main className="app">
      <PageHeader title="Community" subtitle="Membership is what makes you eligible for rewards" />
      <RequireSession>
        <CommunityContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
