'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../../components/shell';
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

  const inChannel = data.membership?.status === 'ACTIVE' || data.membership?.status === 'REJOIN_COOLDOWN';

  return (
    <>
      <div className="card">
        <h2>{data.name}</h2>
        <p className="muted small">{data.description ?? 'A CLE community.'}</p>
        <div className="row">
          <div className="secondary">Channel</div>
          <div className="value">{data.channel.username ? `@${data.channel.username}` : data.channel.title}</div>
        </div>
        <div className="row">
          <div className="secondary">Members</div>
          <div className="value">{data.memberCount}</div>
        </div>
        <div className="row">
          <div className="secondary">Your points</div>
          <div className="value">{data.membership?.learningPoints ?? 0}</div>
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
