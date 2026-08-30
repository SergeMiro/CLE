'use client';

import { CHAIN, TonConnectUIProvider, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { config, miniAppReturnUrl } from '../lib/config';
import { useSession } from '../lib/session';
import { haptic } from '../lib/telegram';
import { CheckIcon, WalletIcon } from './icons';

/**
 * The server will not take an address that was typed in: linking a wallet needs
 * a `ton_proof` — the wallet signing a nonce we issued, for our domain. That is
 * what TON Connect produces, and it is why pasting an address into the old
 * field always failed outside mock mode.
 */
export function TonWalletProvider({ children }: { children: ReactNode }) {
  const returnUrl = miniAppReturnUrl();
  return (
    <TonConnectUIProvider
      manifestUrl={config().manifestUrl}
      {...(returnUrl ? { actionsConfiguration: { twaReturnUrl: returnUrl as `${string}://${string}` } } : {})}
    >
      {children}
    </TonConnectUIProvider>
  );
}

interface Props {
  linkedAddress: string | undefined;
  onLinked: () => void;
}

export function TonConnectSection({ linkedAddress, onLinked }: Props) {
  const { token } = useSession();
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const challengeId = useRef<string>(undefined);
  const expectedChain = config().tonNetwork === 'mainnet' ? CHAIN.MAINNET : CHAIN.TESTNET;

  /**
   * The nonce has to be in the wallet's hands *before* the modal opens, because
   * it is what the wallet signs. It is single use, so a fresh one is issued
   * after every attempt.
   */
  const armProof = useCallback(async () => {
    if (!token) return;
    tonConnectUI.setConnectRequestParameters({ state: 'loading' });
    try {
      const challenge = await api.post<{ challengeId: string; nonce: string }>('/api/v1/me/wallets/challenge', {}, token);
      challengeId.current = challenge.challengeId;
      tonConnectUI.setConnectRequestParameters({ state: 'ready', value: { tonProof: challenge.nonce } });
    } catch (cause) {
      challengeId.current = undefined;
      tonConnectUI.setConnectRequestParameters(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [token, tonConnectUI]);

  useEffect(() => {
    void armProof();
  }, [armProof]);

  useEffect(
    () =>
      tonConnectUI.onStatusChange(async (connected) => {
        const item = connected?.connectItems?.tonProof;
        // A restored session carries no proof — only a fresh connect does.
        if (!connected || !item) return;
        if (!('proof' in item)) {
          setError('the wallet refused to sign the proof');
          return;
        }
        if (!challengeId.current) {
          setError('the linking request expired — try again');
          return;
        }
        if (connected.account.chain !== expectedChain) {
          setError(
            `this wallet is on ${connected.account.chain === CHAIN.MAINNET ? 'mainnet' : 'testnet'}, and CLE is configured for ${config().tonNetwork}`,
          );
          await tonConnectUI.disconnect();
          return;
        }

        setBusy(true);
        setError(undefined);
        try {
          await api.post(
            '/api/v1/me/wallets',
            {
              challengeId: challengeId.current,
              proof: {
                timestamp: item.proof.timestamp,
                domain: item.proof.domain,
                signature: item.proof.signature,
                payload: item.proof.payload,
                publicKeyHex: connected.account.publicKey,
                address: connected.account.address,
              },
            },
            token,
          );
          haptic('success');
          onLinked();
        } catch (cause) {
          haptic('error');
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          challengeId.current = undefined;
          setBusy(false);
          void armProof();
        }
      }),
    [armProof, expectedChain, onLinked, token, tonConnectUI],
  );

  return (
    <div className="card">
      <h2>TON wallet</h2>
      {linkedAddress ? (
        <>
          <div className="copyable mb">
            <CheckIcon width={16} height={16} style={{ color: 'var(--positive)', flex: 'none' }} />
            <span className="mono">{linkedAddress}</span>
          </div>
          <p className="muted small mb">Rewards are paid to this address. Connect again to replace it.</p>
        </>
      ) : (
        <p className="muted small mb">
          Connect the wallet that should receive your rewards. Your wallet signs a one-time code to prove it is yours — CLE
          never asks for a seed phrase, and cannot move funds.
        </p>
      )}

      {error ? <div className="notice error">{error}</div> : null}

      <div className="stack">
        <button
          type="button"
          className="btn"
          disabled={busy || !token}
          onClick={async () => {
            setError(undefined);
            // A wallet already attached to this browser will not raise a fresh
            // proof, so drop it before asking again.
            if (wallet) await tonConnectUI.disconnect();
            await armProof();
            await tonConnectUI.openModal();
          }}
        >
          <WalletIcon width={18} height={18} />
          {busy ? 'Linking…' : linkedAddress ? 'Connect a different wallet' : 'Connect TON wallet'}
        </button>
        {wallet ? (
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void tonConnectUI.disconnect()}>
            Disconnect
          </button>
        ) : null}
      </div>
    </div>
  );
}
