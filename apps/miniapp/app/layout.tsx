import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { SessionProvider } from '../lib/session';
import './globals.css';

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
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Telegram injects window.Telegram.WebApp; the app also runs in a plain browser for development. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
