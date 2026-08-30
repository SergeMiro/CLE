'use client';

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number; username?: string; first_name?: string } };
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  ready: () => void;
  expand: () => void;
  close: () => void;
  HapticFeedback?: { impactOccurred: (style: string) => void; notificationOccurred: (type: string) => void };
  MainButton?: { show: () => void; hide: () => void; setText: (text: string) => void; onClick: (handler: () => void) => void };
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  isVersionAtLeast?: (version: string) => boolean;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function webApp(): TelegramWebApp | undefined {
  return typeof window === 'undefined' ? undefined : window.Telegram?.WebApp;
}

/**
 * Inside Telegram the signed initData is the credential. Outside it — a plain
 * browser during development — `?mockUser=<telegram id>` stands in, and the API
 * only accepts that shortcut while APP_MODE=mock.
 */
export function credentials(): { initData: string; startParam?: string } | undefined {
  const app = webApp();
  if (app?.initData) {
    const startParam = app.initDataUnsafe?.start_param;
    return { initData: app.initData, ...(startParam ? { startParam } : {}) };
  }
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const mockUser = params.get('mockUser');
  if (!mockUser) return undefined;
  const startParam = params.get('startapp') ?? params.get('tgWebAppStartParam') ?? undefined;
  const username = params.get('mockUsername');
  return {
    initData: `mock:${mockUser}${username ? `:${username}` : ''}`,
    ...(startParam ? { startParam } : {}),
  };
}

export function isInsideTelegram(): boolean {
  return Boolean(webApp()?.initData);
}

/**
 * Which Telegram account is opening the app right now. A stored session that
 * belongs to somebody else must be discarded rather than reused — that happens
 * when a device switches Telegram accounts, and constantly while testing with
 * ?mockUser=.
 */
export function expectedTelegramId(): string | undefined {
  const app = webApp();
  if (app?.initData && app.initDataUnsafe?.user?.id) return String(app.initDataUnsafe.user.id);
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('mockUser') ?? undefined;
}

export function haptic(kind: 'light' | 'success' | 'error' = 'light'): void {
  const app = webApp();
  if (!app?.HapticFeedback) return;
  if (kind === 'light') app.HapticFeedback.impactOccurred('light');
  else app.HapticFeedback.notificationOccurred(kind);
}

export function openLink(url: string): void {
  const app = webApp();
  if (url.startsWith('https://t.me/') && app?.openTelegramLink) app.openTelegramLink(url);
  else if (app?.openLink) app.openLink(url);
  else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
}

/**
 * Telegram decides light or dark per client, which is not always what the OS
 * says, so `prefers-color-scheme` alone gets it wrong inside the app. The
 * scheme is mirrored onto <html data-theme> and the client chrome is painted
 * with the same grey as the page, so the Mini App has no visible seam.
 */
export function syncColorScheme(): () => void {
  if (typeof document === 'undefined') return () => {};
  const app = webApp();

  const apply = () => {
    const scheme = app?.colorScheme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = scheme;
    // Painting the client chrome only makes sense inside Telegram, and only
    // from 6.9 — older clients answer with a console warning instead.
    if (!app?.initData || !app.isVersionAtLeast?.('6.9')) return;
    const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    // Only a #rrggbb value is accepted; a var() or color-mix() result is not.
    if (/^#[0-9a-f]{6}$/i.test(page)) {
      app.setHeaderColor?.(page);
      app.setBackgroundColor?.(page);
    }
  };

  apply();
  app?.onEvent?.('themeChanged', apply);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', apply);
  return () => {
    app?.offEvent?.('themeChanged', apply);
    media?.removeEventListener?.('change', apply);
  };
}
