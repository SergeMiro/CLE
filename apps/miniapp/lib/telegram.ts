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
