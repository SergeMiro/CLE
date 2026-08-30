'use client';

export interface CleConfig {
  /** `live` refuses an address typed by hand; only a signed ton_proof links a wallet. */
  appMode: 'live' | 'mock';
  tonNetwork: 'mainnet' | 'testnet';
  manifestUrl: string;
  botUsername: string;
  miniAppName: string;
}

declare global {
  interface Window {
    __CLE_CONFIG__?: Partial<CleConfig>;
  }
}

const FALLBACK: CleConfig = {
  appMode: 'mock',
  tonNetwork: 'testnet',
  manifestUrl: '/tonconnect-manifest.json',
  botUsername: '',
  miniAppName: '',
};

/** Injected by the server layout at request time, like the API address. */
export function config(): CleConfig {
  const injected = typeof window === 'undefined' ? undefined : window.__CLE_CONFIG__;
  const merged = { ...FALLBACK, ...injected };
  // An empty MINI_APP_URL would leave the manifest path relative to nothing.
  if (!merged.manifestUrl.startsWith('http') && typeof window !== 'undefined') {
    merged.manifestUrl = `${window.location.origin}/tonconnect-manifest.json`;
  }
  return merged;
}

/** Where a wallet should send the person back to after they sign. */
export function miniAppReturnUrl(): string | undefined {
  const { botUsername, miniAppName } = config();
  if (!botUsername) return undefined;
  const bot = botUsername.replace(/^@/, '');
  return miniAppName ? `https://t.me/${bot}/${miniAppName}` : `https://t.me/${bot}`;
}
