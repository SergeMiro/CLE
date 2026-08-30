'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../../components/shell';
import { Slider } from '../../../components/slider';
import { api } from '../../../lib/api';
import { formatDate, formatTon, tonToNanoton } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';

interface Analytics {
  members: number;
  activeMembers: number;
  joins30d: number;
  leaves30d: number;
  rejoins30d: number;
  retentionPercent: number;
  quizzesPublished: number;
  quizAttempts: number;
  quizCompletionPercent: number;
  learningPoints: number;
  qualifiedReferrals: number;
  treasuryNanoton: string;
  distributedNanoton: string;
  rewardPerActiveMemberNanoton: string;
  revenuePerActiveMemberNanoton: string;
}

interface Policies {
  platform: { platformFeeBps: number; maxCreatorShareBps: number; minWithdrawalNanoton: string; maxQuizzesPerDay: number };
  revenue: { creatorShareBps: number; version: number };
  reward: { growthBps: number; loyaltyBps: number; referralBps: number; learningBps: number; version: number; newMemberHoldDays: number };
  quiz: {
    enabled: boolean;
    mode: string;
    questionsPerQuiz: number;
    difficulty: string;
    language: string;
    quizDelayMinutes: number;
    dailyQuizLimit: number;
    minimumPostLength: number;
    publishButtonText: string;
    qualityThreshold: number;
    version: number;
  };
}

interface RevenueCycle {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossNanoton: string;
  platformFeeNanoton: string;
  creatorShareNanoton: string;
  communityShareNanoton: string;
  status: string;
  rewardCycle: { id: string; status: string; allocatedNanoton: string } | null;
}

interface Quiz {
  id: string;
  title: string;
  status: string;
  qualityScore: number | null;
  createdAt: string;
  _count: { questions: number; attempts: number };
}

interface ContentItem {
  id: string;
  text: string;
  status: string;
  publishedAt: string;
  skipReason: string | null;
  quizzes: { id: string; status: string; title: string }[];
}

type Tab = 'overview' | 'quiz' | 'revenue' | 'settings';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function run(task: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await task();
      if (success) setMessage(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, message, run };
}

function OverviewTab({ communityId }: { communityId: string }) {
  const analytics = useApi<Analytics>(`/api/v1/communities/${communityId}/analytics`);
  if (analytics.loading && !analytics.data) return <Loading />;
  if (analytics.error) return <ErrorNotice message={analytics.error} />;
  const data = analytics.data;
  if (!data) return null;

  return (
    <>
      <div className="stat-row mb">
        <div className="stat">
          <div className="value">{data.activeMembers}</div>
          <div className="label">Active members</div>
        </div>
        <div className="stat">
          <div className="value">{data.retentionPercent}%</div>
          <div className="label">Retention</div>
        </div>
        <div className="stat">
          <div className="value">{data.qualifiedReferrals}</div>
          <div className="label">Referrals</div>
        </div>
      </div>
      <div className="card">
        <h2>Membership</h2>
        <div className="row"><div className="secondary">Members</div><div className="value">{data.members}</div></div>
        <div className="row"><div className="secondary">Joins (30 days)</div><div className="value">{data.joins30d}</div></div>
        <div className="row"><div className="secondary">Leaves (30 days)</div><div className="value">{data.leaves30d}</div></div>
        <div className="row"><div className="secondary">Rejoins (30 days)</div><div className="value">{data.rejoins30d}</div></div>
      </div>
      <div className="card">
        <h2>Learning</h2>
        <div className="row"><div className="secondary">Quizzes published</div><div className="value">{data.quizzesPublished}</div></div>
        <div className="row"><div className="secondary">Quiz attempts</div><div className="value">{data.quizAttempts}</div></div>
        <div className="row"><div className="secondary">Participation</div><div className="value">{data.quizCompletionPercent}%</div></div>
        <div className="row"><div className="secondary">Learning points</div><div className="value">{data.learningPoints}</div></div>
      </div>
      <div className="card">
        <h2>Money</h2>
        <div className="row"><div className="secondary">Community treasury</div><div className="value">{formatTon(data.treasuryNanoton)} TON</div></div>
        <div className="row"><div className="secondary">Distributed to members</div><div className="value">{formatTon(data.distributedNanoton)} TON</div></div>
        <div className="row"><div className="secondary">Reward per active member</div><div className="value">{formatTon(data.rewardPerActiveMemberNanoton)} TON</div></div>
        <div className="row"><div className="secondary">Revenue per active member</div><div className="value">{formatTon(data.revenuePerActiveMemberNanoton)} TON</div></div>
      </div>
    </>
  );
}

function QuizTab({ communityId }: { communityId: string }) {
  const { token } = useSession();
  const policies = useApi<Policies>(`/api/v1/communities/${communityId}/policies`);
  const quizzes = useApi<Quiz[]>(`/api/v1/communities/${communityId}/quizzes`);
  const content = useApi<ContentItem[]>(`/api/v1/communities/${communityId}/content`);
  const action = useAction();
  const quiz = policies.data?.quiz;

  const [form, setForm] = useState<{ enabled: boolean; mode: string; questionsPerQuiz: number; quizDelayMinutes: number } | undefined>();
  const current = form ?? (quiz ? { enabled: quiz.enabled, mode: quiz.mode, questionsPerQuiz: quiz.questionsPerQuiz, quizDelayMinutes: quiz.quizDelayMinutes } : undefined);

  return (
    <>
      {action.error ? <ErrorNotice message={action.error} /> : null}
      {action.message ? <div className="notice ok">{action.message}</div> : null}

      <div className="card">
        <h2>AI quizzes</h2>
        {current ? (
          <>
            <div className="row">
              <div className="secondary">Status</div>
              <div className="value">
                <span className={`pill ${current.enabled ? 'ok' : 'neutral'}`}>{current.enabled ? 'ON' : 'OFF'}</span>
              </div>
            </div>
            <label className="small muted">Mode</label>
            <select className="select" value={current.mode} onChange={(event) => setForm({ ...current, mode: event.target.value })}>
              <option value="MANUAL">Manual — hold every quiz for review</option>
              <option value="AUTO">Automatic — publish when quality passes</option>
            </select>
            <label className="small muted">Questions per quiz</label>
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={current.questionsPerQuiz}
              onChange={(event) => setForm({ ...current, questionsPerQuiz: Number(event.target.value) })}
            />
            <label className="small muted">Delay after the post (minutes)</label>
            <input
              className="input"
              type="number"
              min={0}
              max={1440}
              value={current.quizDelayMinutes}
              onChange={(event) => setForm({ ...current, quizDelayMinutes: Number(event.target.value) })}
            />
            <div className="stack">
              <button
                type="button"
                className="btn"
                disabled={action.busy}
                onClick={async () => {
                  const ok = await action.run(
                    () => api.post(`/api/v1/communities/${communityId}/policies/quiz`, { ...current, enabled: true }, token),
                    'Quiz policy saved.',
                  );
                  if (ok) policies.reload();
                }}
              >
                Save and enable
              </button>
              {current.enabled ? (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={action.busy}
                  onClick={async () => {
                    const ok = await action.run(
                      () => api.post(`/api/v1/communities/${communityId}/policies/quiz`, { ...current, enabled: false }, token),
                      'Automatic quizzes turned off.',
                    );
                    if (ok) policies.reload();
                  }}
                >
                  Turn off
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <Loading rows={1} />
        )}
      </div>

      <div className="card">
        <h2>Posts</h2>
        {content.data && content.data.length > 0 ? (
          content.data.slice(0, 8).map((item) => (
            <div className="row" key={item.id}>
              <div style={{ minWidth: 0 }}>
                <div className="primary" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.text.slice(0, 60)}
                </div>
                <div className="secondary muted">
                  {formatDate(item.publishedAt)} · {item.skipReason ?? item.status.toLowerCase()}
                </div>
              </div>
              {item.quizzes.length === 0 ? (
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={action.busy}
                  onClick={async () => {
                    const ok = await action.run(() => api.post(`/api/v1/content/${item.id}/quiz`, {}, token), 'Quiz generated.');
                    if (ok) {
                      quizzes.reload();
                      content.reload();
                    }
                  }}
                >
                  Make quiz
                </button>
              ) : (
                <span className="pill neutral">{item.quizzes[0]!.status}</span>
              )}
            </div>
          ))
        ) : (
          <p className="muted small">No posts ingested yet. Post in the channel and CLE will pick it up.</p>
        )}
      </div>

      <div className="card">
        <h2>Quizzes</h2>
        {quizzes.data && quizzes.data.length > 0 ? (
          quizzes.data.map((item) => (
            <div className="row" key={item.id}>
              <div>
                <div className="primary">{item.title}</div>
                <div className="secondary muted">
                  {item._count.questions} questions · {item._count.attempts} attempts
                  {item.qualityScore !== null ? ` · quality ${item.qualityScore}` : ''}
                </div>
              </div>
              {item.status === 'PUBLISHED' ? (
                <span className="pill ok">LIVE</span>
              ) : (
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={action.busy}
                  onClick={async () => {
                    const ok = await action.run(async () => {
                      if (item.status !== 'APPROVED') await api.post(`/api/v1/quizzes/${item.id}/approve`, {}, token);
                      await api.post(`/api/v1/quizzes/${item.id}/publish`, {}, token);
                    }, 'Quiz published to the channel.');
                    if (ok) quizzes.reload();
                  }}
                >
                  Publish
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="muted small">No quizzes yet.</p>
        )}
      </div>
    </>
  );
}

function RevenueTab({ communityId }: { communityId: string }) {
  const { token } = useSession();
  const cycles = useApi<RevenueCycle[]>(`/api/v1/communities/${communityId}/revenue-cycles`);
  const action = useAction();
  const [amount, setAmount] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  return (
    <>
      {action.error ? <ErrorNotice message={action.error} /> : null}
      {action.message ? <div className="notice ok">{action.message}</div> : null}

      <div className="card">
        <h2>Record a revenue period</h2>
        <p className="muted small">
          Revenue is recorded, funded, then split: the CLE fee first, then your share, then the community.
        </p>
        <input className="input" placeholder="Amount in TON" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <label className="small muted">Period start</label>
        <input className="input" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
        <label className="small muted">Period end</label>
        <input className="input" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
        <button
          type="button"
          className="btn"
          disabled={action.busy || !amount || !periodStart || !periodEnd}
          onClick={async () => {
            const start = new Date(`${periodStart}T00:00:00.000Z`).toISOString();
            const end = new Date(`${periodEnd}T00:00:00.000Z`).toISOString();
            const ok = await action.run(async () => {
              const entry = await api.post<{ id: string }>(
                `/api/v1/communities/${communityId}/revenue`,
                {
                  source: 'telegram_ads',
                  amountNanoton: tonToNanoton(amount),
                  periodStart: start,
                  periodEnd: end,
                  externalReference: `manual-${Date.now()}`,
                },
                token,
              );
              await api.post(`/api/v1/revenue/${entry.id}/status`, { status: 'FUNDED' }, token);
              await api.post(`/api/v1/communities/${communityId}/revenue-cycles`, { periodStart: start, periodEnd: end }, token);
            }, 'Revenue recorded, funded and split.');
            if (ok) {
              setAmount('');
              cycles.reload();
            }
          }}
        >
          Record, fund and split
        </button>
      </div>

      {cycles.data?.map((cycle) => (
        <div className="card" key={cycle.id}>
          <div className="spread">
            <div className="primary">
              {formatDate(cycle.periodStart)} – {formatDate(cycle.periodEnd)}
            </div>
            <span className="pill neutral">{cycle.status}</span>
          </div>
          <div className="row mt"><div className="secondary">Gross</div><div className="value">{formatTon(cycle.grossNanoton)} TON</div></div>
          <div className="row"><div className="secondary">CLE fee</div><div className="value">{formatTon(cycle.platformFeeNanoton)} TON</div></div>
          <div className="row"><div className="secondary">Your share</div><div className="value">{formatTon(cycle.creatorShareNanoton)} TON</div></div>
          <div className="row"><div className="secondary">Community share</div><div className="value">{formatTon(cycle.communityShareNanoton)} TON</div></div>

          {cycle.rewardCycle ? (
            <>
              <div className="row"><div className="secondary">Reward cycle</div><div className="value">{cycle.rewardCycle.status}</div></div>
              {cycle.rewardCycle.status !== 'FINALIZED' ? (
                <button
                  type="button"
                  className="btn mt"
                  disabled={action.busy}
                  onClick={async () => {
                    const rewardCycleId = cycle.rewardCycle!.id;
                    const ok = await action.run(async () => {
                      if (cycle.rewardCycle!.status === 'DRAFT') await api.post(`/api/v1/reward-cycles/${rewardCycleId}/calculate`, {}, token);
                      if (cycle.rewardCycle!.status !== 'APPROVED') await api.post(`/api/v1/reward-cycles/${rewardCycleId}/approve`, {}, token);
                      await api.post(`/api/v1/reward-cycles/${rewardCycleId}/finalize`, {}, token);
                    }, 'Rewards distributed to members.');
                    if (ok) cycles.reload();
                  }}
                >
                  {cycle.rewardCycle.status === 'CALCULATED' ? 'Approve and pay out' : 'Continue distribution'}
                </button>
              ) : (
                <div className="row">
                  <div className="secondary">Distributed</div>
                  <div className="value">{formatTon(cycle.rewardCycle.allocatedNanoton)} TON</div>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              className="btn mt"
              disabled={action.busy}
              onClick={async () => {
                const ok = await action.run(async () => {
                  const rewardCycle = await api.post<{ id: string }>(`/api/v1/revenue-cycles/${cycle.id}/reward-cycle`, {}, token);
                  await api.post(`/api/v1/reward-cycles/${rewardCycle.id}/calculate`, {}, token);
                }, 'Rewards calculated. Review, then pay out.');
                if (ok) cycles.reload();
              }}
            >
              Calculate rewards
            </button>
          )}
        </div>
      ))}
    </>
  );
}

/** The four reward pools, named the way a creator reads them. */
const POOL_LABEL = {
  growthBps: 'Growth',
  loyaltyBps: 'Loyalty',
  referralBps: 'Referral',
  learningBps: 'Learning',
} as const;

function SettingsTab({ communityId }: { communityId: string }) {
  const { token } = useSession();
  const policies = useApi<Policies>(`/api/v1/communities/${communityId}/policies`);
  const action = useAction();
  const [creatorShare, setCreatorShare] = useState<number>();
  const [pools, setPools] = useState<{ growthBps: number; loyaltyBps: number; referralBps: number; learningBps: number }>();

  if (policies.loading && !policies.data) return <Loading />;
  if (policies.error) return <ErrorNotice message={policies.error} />;
  const data = policies.data;
  if (!data) return null;

  const share = creatorShare ?? data.revenue.creatorShareBps;
  const maxShare = data.platform.maxCreatorShareBps;
  const currentPools = pools ?? {
    growthBps: data.reward.growthBps,
    loyaltyBps: data.reward.loyaltyBps,
    referralBps: data.reward.referralBps,
    learningBps: data.reward.learningBps,
  };
  const poolTotal = currentPools.growthBps + currentPools.loyaltyBps + currentPools.referralBps + currentPools.learningBps;

  return (
    <>
      {action.error ? <ErrorNotice message={action.error} /> : null}
      {action.message ? <div className="notice ok">{action.message}</div> : null}

      <div className="card">
        <h2>Revenue split</h2>
        <p className="muted small">
          CLE takes {data.platform.platformFeeBps / 100}% of gross. You may take up to {maxShare / 100}% of what remains; the rest
          goes to the community.
        </p>
        <Slider
          label="Your share of the remainder"
          hint={`${(share / 100).toFixed(2)}%`}
          max={maxShare}
          step={25}
          value={share}
          onChange={setCreatorShare}
        />
        {(() => {
          // The same split the ledger will make, shown on a round number so the
          // slider means something before it is saved.
          const fee = data.platform.platformFeeBps / 100;
          const net = 100 - fee;
          const creator = (net * share) / 10_000;
          return (
            <div className="split-preview mb">
              <div>
                <div className="value">{fee.toFixed(1)}</div>
                <div className="label">CLE fee</div>
              </div>
              <div>
                <div className="value">{creator.toFixed(2)}</div>
                <div className="label">You</div>
              </div>
              <div>
                <div className="value">{(net - creator).toFixed(2)}</div>
                <div className="label">Community</div>
              </div>
            </div>
          );
        })()}
        <button
          type="button"
          className="btn"
          disabled={action.busy || share === data.revenue.creatorShareBps}
          onClick={async () => {
            const ok = await action.run(
              () => api.post(`/api/v1/communities/${communityId}/policies/revenue`, { creatorShareBps: share }, token),
              'Saved. It applies to future cycles only.',
            );
            if (ok) policies.reload();
          }}
        >
          Save revenue policy
        </button>
      </div>

      <div className="card">
        <h2>Reward pools</h2>
        <p className="muted small">How the community share is divided. The four pools must total 100%.</p>
        {(['growthBps', 'loyaltyBps', 'referralBps', 'learningBps'] as const).map((key) => (
          <Slider
            key={key}
            label={POOL_LABEL[key]}
            hint={`${(currentPools[key] / 100).toFixed(0)}%`}
            max={10_000}
            step={250}
            value={currentPools[key]}
            onChange={(next) => setPools({ ...currentPools, [key]: next })}
          />
        ))}
        <div className={`notice ${poolTotal === 10_000 ? 'ok' : 'error'}`}>Total: {(poolTotal / 100).toFixed(0)}%</div>
        <button
          type="button"
          className="btn"
          disabled={action.busy || poolTotal !== 10_000}
          onClick={async () => {
            const ok = await action.run(
              () => api.post(`/api/v1/communities/${communityId}/policies/reward`, currentPools, token),
              'Saved. It applies to future cycles only.',
            );
            if (ok) policies.reload();
          }}
        >
          Save reward policy
        </button>
      </div>

      <div className="card">
        <h2>Platform limits</h2>
        <div className="row"><div className="secondary">CLE fee</div><div className="value">{data.platform.platformFeeBps / 100}%</div></div>
        <div className="row"><div className="secondary">Maximum creator share</div><div className="value">{maxShare / 100}%</div></div>
        <div className="row"><div className="secondary">Quizzes per day</div><div className="value">{data.platform.maxQuizzesPerDay}</div></div>
        <div className="row"><div className="secondary">Minimum withdrawal</div><div className="value">{formatTon(data.platform.minWithdrawalNanoton)} TON</div></div>
        <div className="row"><div className="secondary">New member hold</div><div className="value">{data.reward.newMemberHoldDays} days</div></div>
      </div>
    </>
  );
}

function CommunityAdmin() {
  const params = useParams<{ communityId: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const communityId = params?.communityId;
  if (!communityId) return null;

  return (
    <>
      <div className="tabs">
        {(['overview', 'quiz', 'revenue', 'settings'] as Tab[]).map((candidate) => (
          <button key={candidate} type="button" className={tab === candidate ? 'active' : ''} onClick={() => setTab(candidate)}>
            {candidate === 'quiz' ? 'Quiz AI' : candidate.charAt(0).toUpperCase() + candidate.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'overview' ? <OverviewTab communityId={communityId} /> : null}
      {tab === 'quiz' ? <QuizTab communityId={communityId} /> : null}
      {tab === 'revenue' ? <RevenueTab communityId={communityId} /> : null}
      {tab === 'settings' ? <SettingsTab communityId={communityId} /> : null}
    </>
  );
}

export default function CommunityAdminPage() {
  return (
    <main className="app">
      <PageHeader
        title="Community"
        subtitle="Analytics, AI quizzes, revenue and policy"
        action={
          <Link href="/creator" className="btn secondary small">
            Back
          </Link>
        }
      />
      <RequireSession>
        <CommunityAdmin />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
