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

type Tab = 'overview' | 'withdrawals' | 'organizations' | 'ai';

function OverviewTab() {
  const overview = useApi<PlatformOverview>('/api/v1/admin/overview');
  const health = useApi<LedgerHealth>('/api/v1/admin/ledger/health');
  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error) return <ErrorNotice message={overview.error} />;
  const data = overview.data;
  if (!data) return null;

  return (
    <>
      <div className="card balance">
        <div className="amount">
          {formatTon(data.platformTreasuryNanoton)}
          <span>TON</span>
        </div>
        <div className="caption">CLE platform treasury</div>
      </div>

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
        {(['overview', 'withdrawals', 'organizations', 'ai'] as Tab[]).map((candidate) => (
          <button key={candidate} type="button" className={tab === candidate ? 'active' : ''} onClick={() => setTab(candidate)}>
            {candidate === 'ai' ? 'AI usage' : candidate.charAt(0).toUpperCase() + candidate.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'overview' ? <OverviewTab /> : null}
      {tab === 'withdrawals' ? <WithdrawalsTab /> : null}
      {tab === 'organizations' ? <OrganizationsTab /> : null}
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
