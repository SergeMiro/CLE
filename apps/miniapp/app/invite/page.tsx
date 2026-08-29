'use client';

import { useState } from 'react';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { formatDate } from '../../lib/format';
import { useApi } from '../../lib/use-api';

interface ReferralPage {
  referralCode: string;
  platformLink: string;
  communityLinks: { communityId: string; communityName: string; link: string }[];
  referrals: { id: string; scope: string; status: string; community: { name: string } | null; createdAt: string; qualifiedAt: string | null }[];
}

const STATUS_PILL: Record<string, string> = { QUALIFIED: 'ok', REWARDED: 'ok', PENDING: 'warn', REJECTED: 'bad' };

function CopyRow({ label, link }: { label: string; link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb">
      <div className="small muted mb">{label}</div>
      <div className="mono mb">{link}</div>
      <button
        type="button"
        className="btn secondary small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

function InviteContent() {
  const { data, error, loading } = useApi<ReferralPage>('/api/v1/me/referrals');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="card">
        <h2>Your invite links</h2>
        <p className="muted small">
          A community invite pays from that community&apos;s referral pool once the person you invited has stayed in the channel.
        </p>
        {data.communityLinks.map((link) => (
          <CopyRow key={link.communityId} label={link.communityName} link={link.link} />
        ))}
        <CopyRow label="CLE platform invite" link={data.platformLink} />
        <div className="small muted">
          Referral code: <span className="mono">{data.referralCode}</span>
        </div>
      </div>

      <div className="card">
        <h2>People you invited</h2>
        {data.referrals.length === 0 ? (
          <p className="muted small">Nobody yet.</p>
        ) : (
          data.referrals.map((referral) => (
            <div className="row" key={referral.id}>
              <div>
                <div className="primary">{referral.community?.name ?? 'CLE platform'}</div>
                <div className="secondary muted">
                  invited {formatDate(referral.createdAt)}
                  {referral.qualifiedAt ? ` · qualified ${formatDate(referral.qualifiedAt)}` : ''}
                </div>
              </div>
              <span className={`pill ${STATUS_PILL[referral.status] ?? 'neutral'}`}>{referral.status}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

export default function InvitePage() {
  return (
    <main className="app">
      <PageHeader title="Invite" subtitle="Bring people in and share the referral pool" />
      <RequireSession>
        <InviteContent />
      </RequireSession>
      <BottomNav />
    </main>
  );
}
