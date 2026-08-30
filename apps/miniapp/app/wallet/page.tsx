'use client';

import { useState } from 'react';
import { BottomNav, ErrorNotice, Loading, PageHeader, RequireSession } from '../../components/shell';
import { TonConnectSection, TonWalletProvider } from '../../components/ton-connect';
import { api } from '../../lib/api';
import { config } from '../../lib/config';
import { formatDate, formatTon, tonToNanoton } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/use-api';

interface Wallet {
  id: string;
  addressFriendly: string;
  network: string;
  isPrimary: boolean;
  verifiedAt: string | null;
}

interface Withdrawal {
  id: string;
  amountNanoton: string;
  status: string;
  txHash: string | null;
  requestedAt: string;
  failureReason: string | null;
  wallet: { addressFriendly: string };
}

interface Home {
  balance: { available: string; pending: string; locked: string; total: string };
}

const STATUS_PILL: Record<string, string> = {
  CONFIRMED: 'ok',
  REQUESTED: 'warn',
  LOCKED: 'warn',
  PROCESSING: 'warn',
  SUBMITTED: 'warn',
  FAILED: 'bad',
  CANCELLED: 'neutral',
};

function WalletContent() {
  const { token } = useSession();
  const home = useApi<Home>('/api/v1/me/home');
  const wallets = useApi<Wallet[]>('/api/v1/me/wallets');
  const withdrawals = useApi<Withdrawal[]>('/api/v1/me/withdrawals');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const primary = wallets.data?.find((wallet) => wallet.isPrimary);

  async function linkWallet() {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await api.post('/api/v1/me/wallets', { address: address.trim() }, token);
      setAddress('');
      setMessage('Wallet linked.');
      wallets.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await api.post('/api/v1/me/withdrawals', { amountNanoton: tonToNanoton(amount) }, token);
      setAmount('');
      setMessage('Withdrawal requested. It is paid out once processed.');
      home.reload();
      withdrawals.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (home.loading && !home.data) return <Loading hero rows={2} />;

  return (
    <>
      <section className="hero">
        <div className="eyebrow">Available across every community</div>
        <div className="amount">
          {formatTon(home.data?.balance.available)}
          <span className="unit">TON</span>
        </div>
      </section>

      <div className="stat-row mb">
        <div className="stat">
          <div className="value">{formatTon(home.data?.balance.pending, 2)}</div>
          <div className="label">Pending</div>
        </div>
        <div className="stat">
          <div className="value">{formatTon(home.data?.balance.locked, 2)}</div>
          <div className="label">Locked</div>
        </div>
        <div className="stat">
          <div className="value">{formatTon(home.data?.balance.total, 2)}</div>
          <div className="label">Earned</div>
        </div>
      </div>

      {error ? <ErrorNotice message={error} /> : null}
      {message ? <div className="notice ok">{message}</div> : null}

      <TonConnectSection
        linkedAddress={primary?.addressFriendly}
        onLinked={() => {
          setMessage('Wallet linked.');
          wallets.reload();
        }}
      />
      {primary ? (
        <p className="muted small center mb" style={{ marginTop: -6 }}>
          {primary.network.toLowerCase()} · linked {formatDate(primary.verifiedAt)}
        </p>
      ) : null}

      {/* Typing an address only works in mock mode — the live API demands a
          signed proof — so the field is not offered where it cannot succeed. */}
      {config().appMode === 'mock' ? (
        <div className="card">
          <h2>Paste an address (mock mode)</h2>
          <label className="field" htmlFor="ton-address">
            TON address
          </label>
          <input
            id="ton-address"
            className="input"
            placeholder="UQ… or 0:…"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <button type="button" className="btn secondary" disabled={busy || address.trim().length < 10} onClick={linkWallet}>
            {primary ? 'Replace wallet' : 'Link wallet'}
          </button>
        </div>
      ) : null}

      <div className="card">
        <h2>Withdraw</h2>
        <label className="field" htmlFor="ton-amount">
          Amount in TON
        </label>
        <input
          id="ton-amount"
          className="input"
          placeholder="0.00"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <button type="button" className="btn" disabled={busy || !primary || amount.trim() === ''} onClick={withdraw}>
          Withdraw to TON
        </button>
        {!primary ? <p className="muted small mt">Link a wallet first.</p> : null}
      </div>

      <div className="card">
        <h2>History</h2>
        {withdrawals.data && withdrawals.data.length > 0 ? (
          withdrawals.data.map((withdrawal) => (
            <div className="row" key={withdrawal.id}>
              <div>
                <div className="primary">{formatTon(withdrawal.amountNanoton)} TON</div>
                <div className="secondary muted">{formatDate(withdrawal.requestedAt)}</div>
                {withdrawal.failureReason ? <div className="secondary muted">{withdrawal.failureReason}</div> : null}
              </div>
              <span className={`pill ${STATUS_PILL[withdrawal.status] ?? 'neutral'}`}>{withdrawal.status}</span>
            </div>
          ))
        ) : (
          <p className="muted small" style={{ margin: 0 }}>No withdrawals yet.</p>
        )}
      </div>
    </>
  );
}

export default function WalletPage() {
  return (
    <main className="app">
      <PageHeader title="Wallet" subtitle="One balance, one payout address" />
      <RequireSession>
        <TonWalletProvider>
          <WalletContent />
        </TonWalletProvider>
      </RequireSession>
      <BottomNav />
    </main>
  );
}
