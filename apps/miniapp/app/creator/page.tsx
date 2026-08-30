'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { api } from '../../lib/api';
import { Money, MoneyHero } from '../../components/money';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/use-api';

interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
  channelCount: number;
  communityCount: number;
}

interface Overview {
  channels: number;
  communities: number;
  members: number;
  grossRevenueNanoton: string;
  platformFeeNanoton: string;
  creatorEarnedNanoton: string;
  communityShareNanoton: string;
  creatorAvailableNanoton: string;
  quizzesPublished: number;
  learningPoints: number;
}

interface Channel {
  id: string;
  title: string;
  username: string | null;
  status: string;
  monetizationStatus: string;
  missingPermissions: string[];
  memberCount: number | null;
  community: { id: string; slug: string; name: string; status: string; memberCount: number } | null;
}

const CHANNEL_PILL: Record<string, string> = {
  ACTIVE: 'ok',
  DEGRADED: 'warn',
  PENDING: 'warn',
  VERIFYING: 'warn',
  DISCONNECTED: 'bad',
  SUSPENDED: 'bad',
};

function CreateOrganization({ onCreated }: { onCreated: () => void }) {
  const { token, refresh } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <div className="card">
      <h3>Start as a creator</h3>
      <p className="muted small mb">An organization owns your channels, communities, policies and payouts.</p>
      {error ? <ErrorNotice message={error} /> : null}
      <input className="input" placeholder="Organization name" value={name} onChange={(event) => setName(event.target.value)} />
      <button
        type="button"
        className="btn"
        disabled={busy || name.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await api.post('/api/v1/organizations', { name: name.trim() }, token);
            await refresh();
            onCreated();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Create organization
      </button>
    </div>
  );
}

function ConnectChannel({ organizationId, onConnected }: { organizationId: string; onConnected: () => void }) {
  const { token } = useSession();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ status: string; missingRequired: string[]; botIsAdmin: boolean }>();

  return (
    <div className="card">
      <h3>Connect a channel</h3>
      <p className="muted small mb">
        Add the CLE bot to your channel as an administrator with permission to post, then paste the channel here.
      </p>
      {error ? <ErrorNotice message={error} /> : null}
      {result ? (
        <div className={`notice ${result.status === 'ACTIVE' ? 'ok' : 'info'}`}>
          {result.status === 'ACTIVE'
            ? 'Channel verified — the bot has everything it needs.'
            : result.botIsAdmin
              ? `Missing permissions: ${result.missingRequired.join(', ') || 'none required, some optional'}`
              : 'The CLE bot is not an administrator of that channel yet.'}
        </div>
      ) : null}
      <input className="input" placeholder="@channel or https://t.me/channel" value={reference} onChange={(event) => setReference(event.target.value)} />
      <button
        type="button"
        className="btn"
        disabled={busy || reference.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const response = await api.post<{ status: string; missingRequired: string[]; botIsAdmin: boolean }>(
              `/api/v1/organizations/${organizationId}/channels`,
              { reference: reference.trim() },
              token,
            );
            setResult(response);
            setReference('');
            onConnected();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Checking with Telegram…' : 'Connect channel'}
      </button>
    </div>
  );
}

function ChannelCard({ channel, onChanged }: { channel: Channel; onChanged: () => void }) {
  const { token } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="spread">
        <div className="with-badge">
          <span className="mono-badge">{channel.title.slice(0, 1).toUpperCase()}</span>
          <div>
            <div className="primary truncate">{channel.title}</div>
            <div className="secondary truncate">
              {channel.username ? `@${channel.username}` : 'private channel'}
              {channel.memberCount ? ` · ${channel.memberCount} subscribers` : ''}
            </div>
          </div>
        </div>
        <span className={`pill ${CHANNEL_PILL[channel.status] ?? 'neutral'}`}>{channel.status}</span>
      </div>

      {channel.missingPermissions.length > 0 ? (
        <div className="notice info mt">Missing: {channel.missingPermissions.join(', ')}</div>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}

      {channel.community ? (
        <>
          <div className="row mt">
            <div className="secondary">Community</div>
            <div className="value">
              {channel.community.name} · {channel.community.status.toLowerCase()}
            </div>
          </div>
          <div className="stack mt">
            <Link href={`/creator/${channel.community.id}`} className="btn secondary">
              Manage community
            </Link>
            {channel.community.status === 'DRAFT' ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => run(() => api.post(`/api/v1/communities/${channel.community!.id}/launch`, {}, token))}
              >
                Launch community
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="stack mt">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => api.post('/api/v1/communities', { channelId: channel.id }, token))}
          >
            Create community
          </button>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => run(() => api.post(`/api/v1/channels/${channel.id}/verify`, {}, token))}>
            Re-verify permissions
          </button>
        </div>
      )}
    </div>
  );
}

function CreatorContent() {
  const organizations = useApi<OrganizationSummary[]>('/api/v1/organizations');
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    if (!selected && organizations.data?.[0]) setSelected(organizations.data[0].id);
  }, [organizations.data, selected]);

  const overview = useApi<Overview>(selected ? `/api/v1/organizations/${selected}/overview` : undefined);
  const channels = useApi<Channel[]>(selected ? `/api/v1/organizations/${selected}/channels` : undefined);

  if (organizations.loading && !organizations.data) return <Loading />;
  if (organizations.error) return <ErrorNotice message={organizations.error} />;
  if (organizations.data && organizations.data.length === 0) {
    return <CreateOrganization onCreated={() => organizations.reload()} />;
  }

  return (
    <>
      {organizations.data && organizations.data.length > 1 ? (
        <div className="tabs">
          {organizations.data.map((organization) => (
            <button
              key={organization.id}
              type="button"
              className={selected === organization.id ? 'active' : ''}
              onClick={() => setSelected(organization.id)}
            >
              {organization.name}
            </button>
          ))}
        </div>
      ) : null}

      {overview.data ? (
        <>
          <section className="hero">
            <MoneyHero nanoton={overview.data.creatorAvailableNanoton} eyebrow="Your creator balance" />
          </section>
          <div className="stat-row mb">
            <div className="stat">
              <div className="value"><Money nanoton={overview.data.grossRevenueNanoton} tonFractionDigits={2} /></div>
              <div className="label">Gross revenue</div>
            </div>
            <div className="stat">
              <div className="value"><Money nanoton={overview.data.communityShareNanoton} tonFractionDigits={2} /></div>
              <div className="label">To community</div>
            </div>
            <div className="stat">
              <div className="value"><Money nanoton={overview.data.platformFeeNanoton} tonFractionDigits={2} /></div>
              <div className="label">CLE fee</div>
            </div>
          </div>
          <div className="stat-row mb">
            <div className="stat">
              <div className="value">{overview.data.members}</div>
              <div className="label">Members</div>
            </div>
            <div className="stat">
              <div className="value">{overview.data.quizzesPublished}</div>
              <div className="label">Quizzes</div>
            </div>
            <div className="stat">
              <div className="value">{overview.data.learningPoints}</div>
              <div className="label">XP earned</div>
            </div>
          </div>
        </>
      ) : null}

      {channels.data?.map((channel) => (
        <ChannelCard
          key={channel.id}
          channel={channel}
          onChanged={() => {
            channels.reload();
            overview.reload();
          }}
        />
      ))}

      {selected ? (
        <ConnectChannel
          organizationId={selected}
          onConnected={() => {
            channels.reload();
            overview.reload();
          }}
        />
      ) : null}
    </>
  );
}

export default function CreatorPage() {
  return (
    <main className="app">
      <PageHeader
        title="Creator"
        subtitle="Channels, communities and the money they make"
        action={
          <Link href="/" className="btn secondary small">
            Back
          </Link>
        }
      />
      <RequireSession>
        <CreatorContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
