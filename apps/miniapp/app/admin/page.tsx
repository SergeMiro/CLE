'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { api } from '../../lib/api';
import { formatDate, formatTon } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/use-api';

interface PlatformOverview {
  organizations: number;
  channels: number;
  communities: number;
  users: number;
  members: number;
  grossRevenueNanoton: string;
  platformFeeNanoton: string;
  creatorShareNanoton: string;
  communityShareNanoton: string;
  platformTreasuryNanoton: string;
  withdrawalsConfirmedNanoton: string;
  quizzesPublished: number;
  quizAttempts: number;
  aiCostMicroUsd: number;
  openFraudCases: number;
}

interface LedgerHealth {
  netNanoton: string;
  balanced: boolean;
  negativeCustodyAccounts: { account: string; balanceNanoton: string }[];
}

interface AdminWithdrawal {
  id: string;
  amountNanoton: string;
  status: string;
  requestedAt: string;
  txHash: string | null;
  wallet: { addressFriendly: string; network: string };
  user: { telegramUsername: string | null; telegramId: string } | null;
  organization: { name: string } | null;
}

interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  owner: { telegramUsername: string | null; telegramId: string };
  _count: { channels: number; communities: number };
}

interface AiUsageRow {
  provider: string;
  model: string;
  operation: string;
  _count: { _all: number };
  _sum: { inputTokens: number | null; outputTokens: number | null; estimatedCostMicroUsd: number | null };
}

interface AdminAd {
  id: string;
  scope: 'PLATFORM' | 'COMMUNITY';
  sponsor: string;
  headline: string;
  body: string | null;
  ctaLabel: string | null;
  imageUrl: string | null;
  url: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
  weight: number;
  impressions: number;
  clicks: number;
  /** Empty means the campaign runs in every community. */
  targets: { community: { id: string; name: string } }[];
}

interface AdminCommunity {
  id: string;
  name: string;
  slug: string;
  status: string;
  memberCount: number;
  organization: { name: string };
}

type Tab = 'overview' | 'withdrawals' | 'organizations' | 'ads' | 'ai';

const AD_PILL: Record<string, string> = { ACTIVE: 'ok', DRAFT: 'neutral', PAUSED: 'warn', ENDED: 'neutral' };

/** Selling the strip inside a quiz: what runs, where, and what it earned. */
function AdsTab() {
  const { token } = useSession();
  const ads = useApi<AdminAd[]>('/api/v1/admin/ads');
  const communities = useApi<AdminCommunity[]>('/api/v1/admin/communities');
  const [sponsor, setSponsor] = useState('');
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [url, setUrl] = useState('');
  const [targets, setTargets] = useState<string[]>([]);
  const [soldByCommunity, setSoldByCommunity] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [editTargets, setEditTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      ads.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /** No community selected means everywhere, so "Every community" is the empty list. */
  function Picker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
    return (
      <div className="picker">
        <button type="button" className={selected.length === 0 ? 'on' : ''} onClick={() => onChange([])}>
          Every community
        </button>
        {communities.data?.map((community) => (
          <button
            key={community.id}
            type="button"
            className={selected.includes(community.id) ? 'on' : ''}
            onClick={() =>
              onChange(selected.includes(community.id) ? selected.filter((id) => id !== community.id) : [...selected, community.id])
            }
          >
            {community.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {error ? <ErrorNotice message={error} /> : null}

      <div className="card">
        <h2>Sell a slot</h2>
        <p className="muted small mb">One strip runs inside a quiz, between the header and the answers.</p>

        <label className="field" htmlFor="ad-sponsor">
          Sponsor
        </label>
        <input id="ad-sponsor" className="input" value={sponsor} onChange={(event) => setSponsor(event.target.value)} />
        <label className="field" htmlFor="ad-headline">
          Headline
        </label>
        <input id="ad-headline" className="input" value={headline} onChange={(event) => setHeadline(event.target.value)} />
        <label className="field" htmlFor="ad-body">
          Second line (optional)
        </label>
        <input id="ad-body" className="input" value={body} onChange={(event) => setBody(event.target.value)} />
        <label className="field" htmlFor="ad-cta">
          Button label (optional)
        </label>
        <input id="ad-cta" className="input" value={ctaLabel} onChange={(event) => setCtaLabel(event.target.value)} />
        <label className="field" htmlFor="ad-image">
          Image link (optional, https)
        </label>
        <input
          id="ad-image"
          className="input"
          placeholder="https://…/logo.png"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
        />
        {imageUrl.startsWith('https://') ? (
          <div className="copyable mb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ad-image" src={imageUrl} alt="" width={46} height={46} />
            <span className="small muted">Preview — a square logo reads best.</span>
          </div>
        ) : null}
        <label className="field" htmlFor="ad-url">
          Link (https)
        </label>
        <input id="ad-url" className="input" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />

        <div className="field">Where it runs</div>
        <Picker
          selected={targets}
          onChange={(next) => {
            setTargets(next);
            // Priority only means something against a named community.
            if (next.length === 0) setSoldByCommunity(false);
          }}
        />

        <label className="check">
          <input
            type="checkbox"
            checked={soldByCommunity}
            disabled={targets.length === 0}
            onChange={(event) => setSoldByCommunity(event.target.checked)}
          />
          <span>
            <b>Sold by the community</b>
            Takes priority over CLE&apos;s own campaigns there. Needs at least one community.
          </span>
        </label>

        <button
          type="button"
          className="btn"
          disabled={busy || !sponsor.trim() || !headline.trim() || !url.trim()}
          onClick={() =>
            run(async () => {
              await api.post(
                '/api/v1/admin/ads',
                {
                  scope: soldByCommunity ? 'COMMUNITY' : 'PLATFORM',
                  communityIds: targets,
                  sponsor: sponsor.trim(),
                  headline: headline.trim(),
                  ...(body.trim() ? { body: body.trim() } : {}),
                  ...(ctaLabel.trim() ? { ctaLabel: ctaLabel.trim() } : {}),
                  ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
                  url: url.trim(),
                  status: 'ACTIVE',
                },
                token,
              );
              setSponsor('');
              setHeadline('');
              setBody('');
              setCtaLabel('');
              setImageUrl('');
              setUrl('');
              setTargets([]);
              setSoldByCommunity(false);
            })
          }
        >
          Create and run
        </button>
      </div>

      {ads.loading && !ads.data ? <Loading rows={2} /> : null}
      {ads.data?.length === 0 ? <div className="card center muted small">No campaigns yet.</div> : null}
      {ads.data?.map((ad) => (
        <div className="card tight" key={ad.id}>
          <div className="spread mb">
            <div className="with-badge">
              {ad.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="ad-image" src={ad.imageUrl} alt="" width={46} height={46} />
              ) : null}
              <div>
                <div className="primary truncate">{ad.headline}</div>
                <div className="secondary truncate">
                  {ad.sponsor} ·{' '}
                  {ad.targets.length === 0 ? 'every community' : ad.targets.map((target) => target.community.name).join(', ')}
                  {ad.scope === 'COMMUNITY' ? ' · priority' : ''}
                </div>
              </div>
            </div>
            <span className={`pill ${AD_PILL[ad.status] ?? 'neutral'}`}>{ad.status}</span>
          </div>

          <div className="facts">
            <div>
              <div className="value">{ad.impressions}</div>
              <div className="label">Views</div>
            </div>
            <div>
              <div className="value">{ad.clicks}</div>
              <div className="label">Clicks</div>
            </div>
            <div>
              <div className="value">{ad.impressions > 0 ? `${((ad.clicks / ad.impressions) * 100).toFixed(1)}%` : '—'}</div>
              <div className="label">CTR</div>
            </div>
          </div>

          {editing === ad.id ? (
            <div className="mt">
              <div className="field">Where it runs</div>
              <Picker selected={editTargets} onChange={setEditTargets} />
              <div className="grid-2">
                <button
                  type="button"
                  className="btn small"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.post(`/api/v1/admin/ads/${ad.id}/targets`, { communityIds: editTargets }, token);
                      setEditing(undefined);
                    })
                  }
                >
                  Save targeting
                </button>
                <button type="button" className="btn secondary small" style={{ width: '100%' }} onClick={() => setEditing(undefined)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="grid-2 mt">
              <button
                type="button"
                className="btn secondary small"
                style={{ width: '100%' }}
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api.post(`/api/v1/admin/ads/${ad.id}/status`, { status: ad.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }, token),
                  )
                }
              >
                {ad.status === 'ACTIVE' ? 'Pause' : 'Run'}
              </button>
              <button
                type="button"
                className="btn secondary small"
                style={{ width: '100%' }}
                onClick={() => {
                  setEditing(ad.id);
                  setEditTargets(ad.targets.map((target) => target.community.id));
                }}
              >
                Retarget
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function OverviewTab() {
  const overview = useApi<PlatformOverview>('/api/v1/admin/overview');
  const health = useApi<LedgerHealth>('/api/v1/admin/ledger/health');
  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error) return <ErrorNotice message={overview.error} />;
  const data = overview.data;
  if (!data) return null;

  return (
    <>
      <section className="hero">
        <div className="eyebrow">CLE platform treasury</div>
        <div className="amount">
          {formatTon(data.platformTreasuryNanoton)}
          <span className="unit">TON</span>
        </div>
      </section>

      {health.data ? (
        <div className={`notice ${health.data.balanced && health.data.negativeCustodyAccounts.length === 0 ? 'ok' : 'error'}`}>
          {health.data.balanced
            ? 'Ledger balances to zero across every account.'
            : `Ledger is out by ${formatTon(health.data.netNanoton)} TON.`}
          {health.data.negativeCustodyAccounts.length > 0
            ? ` Negative custody: ${health.data.negativeCustodyAccounts.map((row) => row.account).join(', ')}`
            : ''}
        </div>
      ) : null}

      <div className="stat-row mb">
        <div className="stat"><div className="value">{data.organizations}</div><div className="label">Organizations</div></div>
        <div className="stat"><div className="value">{data.communities}</div><div className="label">Communities</div></div>
        <div className="stat"><div className="value">{data.users}</div><div className="label">Users</div></div>
      </div>

      <div className="card">
        <h2>Money</h2>
        <div className="row"><div className="secondary">Gross revenue</div><div className="value">{formatTon(data.grossRevenueNanoton)} TON</div></div>
        <div className="row"><div className="secondary">CLE fee</div><div className="value">{formatTon(data.platformFeeNanoton)} TON</div></div>
        <div className="row"><div className="secondary">Creator share</div><div className="value">{formatTon(data.creatorShareNanoton)} TON</div></div>
        <div className="row"><div className="secondary">Community share</div><div className="value">{formatTon(data.communityShareNanoton)} TON</div></div>
        <div className="row"><div className="secondary">Withdrawn</div><div className="value">{formatTon(data.withdrawalsConfirmedNanoton)} TON</div></div>
      </div>

      <div className="card">
        <h2>Activity</h2>
        <div className="row"><div className="secondary">Channels</div><div className="value">{data.channels}</div></div>
        <div className="row"><div className="secondary">Memberships</div><div className="value">{data.members}</div></div>
        <div className="row"><div className="secondary">Quizzes published</div><div className="value">{data.quizzesPublished}</div></div>
        <div className="row"><div className="secondary">Quiz attempts</div><div className="value">{data.quizAttempts}</div></div>
        <div className="row"><div className="secondary">AI spend</div><div className="value">${(data.aiCostMicroUsd / 1_000_000).toFixed(4)}</div></div>
        <div className="row"><div className="secondary">Open fraud cases</div><div className="value">{data.openFraudCases}</div></div>
      </div>
    </>
  );
}

function WithdrawalsTab() {
  const { token } = useSession();
  const withdrawals = useApi<AdminWithdrawal[]>('/api/v1/admin/withdrawals');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  return (
    <>
      {error ? <ErrorNotice message={error} /> : null}
      {withdrawals.loading && !withdrawals.data ? <Loading /> : null}
      {withdrawals.data?.length === 0 ? <div className="card center muted">No withdrawals yet.</div> : null}
      {withdrawals.data?.map((withdrawal) => (
        <div className="card" key={withdrawal.id}>
          <div className="spread">
            <div>
              <div className="primary">{formatTon(withdrawal.amountNanoton)} TON</div>
              <div className="secondary muted">
                {withdrawal.organization?.name ??
                  (withdrawal.user?.telegramUsername ? `@${withdrawal.user.telegramUsername}` : withdrawal.user?.telegramId)}
                {' · '}
                {formatDate(withdrawal.requestedAt)}
              </div>
              <div className="mono">{withdrawal.wallet.addressFriendly}</div>
            </div>
            <span className={`pill ${withdrawal.status === 'CONFIRMED' ? 'ok' : withdrawal.status === 'FAILED' ? 'bad' : 'warn'}`}>
              {withdrawal.status}
            </span>
          </div>
          {withdrawal.status === 'LOCKED' ? (
            <button
              type="button"
              className="btn mt"
              disabled={busy === withdrawal.id}
              onClick={async () => {
                setBusy(withdrawal.id);
                setError(undefined);
                try {
                  await api.post(`/api/v1/admin/withdrawals/${withdrawal.id}/process`, {}, token);
                  withdrawals.reload();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                } finally {
                  setBusy(undefined);
                }
              }}
            >
              Send payout
            </button>
          ) : null}
          {withdrawal.txHash ? <div className="mono mt">{withdrawal.txHash}</div> : null}
        </div>
      ))}
    </>
  );
}

function OrganizationsTab() {
  const organizations = useApi<AdminOrganization[]>('/api/v1/admin/organizations');
  if (organizations.loading && !organizations.data) return <Loading />;
  if (organizations.error) return <ErrorNotice message={organizations.error} />;
  return (
    <>
      {organizations.data?.map((organization) => (
        <div className="card tight" key={organization.id}>
          <div className="spread">
            <div>
              <div className="primary">{organization.name}</div>
              <div className="secondary muted">
                {organization.owner.telegramUsername ? `@${organization.owner.telegramUsername}` : organization.owner.telegramId} ·{' '}
                {organization._count.channels} channels · {organization._count.communities} communities
              </div>
            </div>
            <span className={`pill ${organization.status === 'ACTIVE' ? 'ok' : 'bad'}`}>{organization.status}</span>
          </div>
        </div>
      ))}
    </>
  );
}

function AiTab() {
  const usage = useApi<AiUsageRow[]>('/api/v1/admin/ai-usage');
  if (usage.loading && !usage.data) return <Loading />;
  if (usage.error) return <ErrorNotice message={usage.error} />;
  if (usage.data?.length === 0) return <div className="card center muted">No AI calls recorded yet.</div>;
  return (
    <>
      {usage.data?.map((row) => (
        <div className="card tight" key={`${row.provider}-${row.model}-${row.operation}`}>
          <div className="primary">
            {row.provider} · {row.model}
          </div>
          <div className="secondary muted">{row.operation}</div>
          <div className="row mt"><div className="secondary">Calls</div><div className="value">{row._count._all}</div></div>
          <div className="row"><div className="secondary">Input tokens</div><div className="value">{row._sum.inputTokens ?? 0}</div></div>
          <div className="row"><div className="secondary">Output tokens</div><div className="value">{row._sum.outputTokens ?? 0}</div></div>
          <div className="row">
            <div className="secondary">Estimated cost</div>
            <div className="value">${((row._sum.estimatedCostMicroUsd ?? 0) / 1_000_000).toFixed(4)}</div>
          </div>
        </div>
      ))}
    </>
  );
}

function AdminContent() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  if (!user?.isPlatformAdmin) {
    return <div className="card center muted">This area is for CLE platform administrators.</div>;
  }
  return (
    <>
      <div className="tabs">
        {(['overview', 'withdrawals', 'organizations', 'ads', 'ai'] as Tab[]).map((candidate) => (
          <button key={candidate} type="button" className={tab === candidate ? 'active' : ''} onClick={() => setTab(candidate)}>
            {candidate === 'ai' ? 'AI usage' : candidate.charAt(0).toUpperCase() + candidate.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'overview' ? <OverviewTab /> : null}
      {tab === 'withdrawals' ? <WithdrawalsTab /> : null}
      {tab === 'organizations' ? <OrganizationsTab /> : null}
      {tab === 'ads' ? <AdsTab /> : null}
      {tab === 'ai' ? <AiTab /> : null}
    </>
  );
}

export default function AdminPage() {
  return (
    <main className="app">
      <PageHeader
        title="Platform"
        subtitle="CLE administration — every organization, all the money"
        action={
          <Link href="/" className="btn secondary small">
            Back
          </Link>
        }
      />
      <RequireSession>
        <AdminContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
