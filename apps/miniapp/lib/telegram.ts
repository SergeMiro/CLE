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

/** Parses the `#rgb`, `#rrggbb` and `rgb()` forms Telegram clients hand out. */
function parseColor(value: string): [number, number, number] | undefined {
  const input = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(input);
  if (short) return [short[1]!, short[2]!, short[3]!].map((part) => Number.parseInt(part + part, 16)) as [number, number, number];
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(input);
  if (long) return [long[1]!, long[2]!, long[3]!].map((part) => Number.parseInt(part, 16)) as [number, number, number];
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(input);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return undefined;
}

/** Perceived lightness, only ever used to compare two greys against each other. */
function lightness(value: string): number | undefined {
  const rgb = parseColor(value);
  if (!rgb) return undefined;
  const [r, g, b] = rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Telegram decides light or dark per client, which is not always what the OS
 * says, so `prefers-color-scheme` alone gets it wrong inside the app. The
 * scheme is mirrored onto <html data-theme> and the client chrome is painted
 * with the same grey as the page, so the Mini App has no visible seam.
 *
 * Which of Telegram's two greys is the page and which is the card cannot be
 * fixed in the stylesheet: on iOS and Android dark, `secondary_bg_color` is the
 * darker one, while on Desktop's Night theme it is the lighter one. Assigning
 * them statically sinks every card on one of those clients. So the two are
 * compared at runtime — the page always takes the darker grey and the cards the
 * lighter one, which is a raised card in every theme.
 */
export function syncColorScheme(): () => void {
  if (typeof document === 'undefined') return () => {};
  const app = webApp();
  const root = document.documentElement;

  const apply = () => {
    const scheme = app?.colorScheme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.dataset.theme = scheme;

    const computed = getComputedStyle(root);
    const bg = computed.getPropertyValue('--tg-theme-bg-color').trim();
    const alt = computed.getPropertyValue('--tg-theme-secondary-bg-color').trim();
    const bgLight = lightness(bg);
    const altLight = lightness(alt);

    if (bgLight !== undefined && altLight !== undefined) {
      const [page, card] = bgLight <= altLight ? [bg, alt] : [alt, bg];
      if (Math.abs(bgLight - altLight) >= 0.012) {
        root.style.setProperty('--page', page);
        root.style.setProperty('--card', card);
      } else if (altLight > 0.85) {
        // A client that gives the same colour twice leaves nothing to separate
        // a card from the page. On an already-white surface the card cannot go
        // lighter, so the page goes darker instead.
        root.style.setProperty('--page', `color-mix(in srgb, ${page} 96%, ${'#000'})`);
        root.style.setProperty('--card', card);
      } else {
        root.style.setProperty('--page', page);
        root.style.setProperty('--card', `color-mix(in srgb, ${card} 93%, #fff)`);
      }
    } else {
      // Outside Telegram the stylesheet's own palette is the right answer.
      root.style.removeProperty('--page');
      root.style.removeProperty('--card');
    }

    // Painting the client chrome only makes sense inside Telegram, and only
    // from 6.9 — older clients answer with a console warning instead.
    if (!app?.initData || !app.isVersionAtLeast?.('6.9')) return;
    const page = getComputedStyle(root).getPropertyValue('--page').trim();
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
