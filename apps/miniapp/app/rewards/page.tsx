'use client';

import { useState } from 'react';
import { BottomNav, Empty, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
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
      {data && data.length === 0 ? <Empty>No rewards yet. They arrive when a community closes a revenue cycle.</Empty> : null}
      {data?.map((allocation) => (
        <div className="card tight" key={allocation.id}>
          <div className="spread">
            <div>
              <div className="primary">{formatTon(allocation.amountNanoton)} TON</div>
              <div className="secondary muted">
                {allocation.community.name} · {allocation.type.toLowerCase()} pool
              </div>
              <div className="secondary muted">
                {formatDate(allocation.cycle.periodStart)} – {formatDate(allocation.cycle.periodEnd)}
              </div>
            </div>
            <span className={`pill ${STATUS_PILL[allocation.status] ?? 'neutral'}`}>{allocation.status}</span>
          </div>
        </div>
      ))}
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
