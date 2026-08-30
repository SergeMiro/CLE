'use client';

import { useState } from 'react';
import { BottomNav, Empty, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { BoltIcon, CommunitiesIcon, LearnIcon, RewardsIcon } from '../../components/icons';
import { formatDate, formatTon } from '../../lib/format';
import { useApi } from '../../lib/use-api';

interface Allocation {
  id: string;
  type: string;
  amountNanoton: string;
  status: string;
  createdAt: string;
  community: { name: string; slug: string };
  cycle: { periodStart: string; periodEnd: string };
}

const STATUS_PILL: Record<string, string> = { AVAILABLE: 'ok', PENDING: 'warn', PAID: 'neutral', CANCELLED: 'bad' };
/* Growth, loyalty, referral and learning each keep one colour and one glyph
   wherever they appear — two of them start with the same letter, so an initial
   would not tell them apart. */
const POOL_TONE: Record<string, string> = { GROWTH: 'growth', LOYALTY: 'loyalty', REFERRAL: 'referral', LEARNING: 'learning' };
const POOL_ICON: Record<string, typeof BoltIcon> = {
  GROWTH: BoltIcon,
  LOYALTY: RewardsIcon,
  REFERRAL: CommunitiesIcon,
  LEARNING: LearnIcon,
};
const FILTERS = ['all', 'AVAILABLE', 'PENDING', 'PAID'] as const;

function RewardsContent() {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('all');
  const { data, error, loading } = useApi<Allocation[]>(
    status === 'all' ? '/api/v1/me/rewards' : `/api/v1/me/rewards?status=${status}`,
  );

  return (
    <>
      <div className="tabs">
        {FILTERS.map((filter) => (
          <button key={filter} type="button" className={status === filter ? 'active' : ''} onClick={() => setStatus(filter)}>
            {filter === 'all' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorNotice message={error} /> : null}
      {data && data.length === 0 ? (
        <Empty icon={<RewardsIcon width={26} height={26} />}>
          No rewards yet. They arrive when a community closes a revenue cycle.
        </Empty>
      ) : null}
      {data?.map((allocation) => {
        const PoolIcon = POOL_ICON[allocation.type] ?? RewardsIcon;
        return (
          <div className="card tight with-badge" key={allocation.id}>
            <span className={`mono-badge ${POOL_TONE[allocation.type] ?? ''}`}>
              <PoolIcon width={18} height={18} />
            </span>
            <div style={{ flex: 1 }}>
              <div className="spread">
                <div className="primary">{formatTon(allocation.amountNanoton)} TON</div>
                <span className={`pill ${STATUS_PILL[allocation.status] ?? 'neutral'}`}>{allocation.status}</span>
              </div>
              <div className="secondary truncate">
                {allocation.community.name} · {allocation.type.toLowerCase()} pool
              </div>
              <div className="secondary truncate">
                {formatDate(allocation.cycle.periodStart)} – {formatDate(allocation.cycle.periodEnd)}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

export default function RewardsPage() {
  return (
    <main className="app">
      <PageHeader title="Rewards" subtitle="Every payout, and which pool it came from" />
      <RequireSession>
        <RewardsContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
