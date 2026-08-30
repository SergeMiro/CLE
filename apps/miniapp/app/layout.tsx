import type { Metadata, Viewport } from 'next';
import { Inter, Manrope } from 'next/font/google';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { StartPayloadRouter } from '../components/start-payload-router';
import { ThemeSync } from '../components/theme-sync';
import { SessionProvider } from '../lib/session';
import './globals.css';

/*
 * Two faces, both self-hosted at build time — no request to Google at runtime
 * and no flash of a fallback. Manrope carries the headings and every figure:
 * geometric, a little characterful, and it makes a balance look like a number
 * worth reading. Inter carries the running text, where it stays legible at the
 * 12–13px the secondary lines use. Cyrillic is not optional — the channels
 * this app reads post in Russian.
 */
const display = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

const text = Inter({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-text',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CLE — Create, Learn & Earn',
  description: 'Learn from the channels you follow and earn a share of what they make.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Resolved on the server for every request: the same image then works in
  // development, staging and production without being rebuilt, and a missing
  // build-time variable cannot bake the wrong address into the bundle.
  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101';
  // Everything else the browser needs to know about this deployment. Resolved
  // here for the same reason as the API address: one image, any environment.
  const config = {
    appMode: process.env.APP_MODE ?? 'mock',
    tonNetwork: process.env.TON_NETWORK ?? 'testnet',
    manifestUrl: `${process.env.MINI_APP_URL ?? ''}/tonconnect-manifest.json`,
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? '',
    miniAppName: process.env.TELEGRAM_MINI_APP_NAME ?? '',
  };
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`} suppressHydrationWarning>
      <body>
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `window.__CLE_API_URL__=${JSON.stringify(apiUrl)};window.__CLE_CONFIG__=${JSON.stringify(config)}`,
          }}
        />
        {/* Telegram injects window.Telegram.WebApp; the app also runs in a plain browser for development. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <SessionProvider>
          <ThemeSync />
          <StartPayloadRouter />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
