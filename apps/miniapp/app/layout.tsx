import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { StartPayloadRouter } from '../components/start-payload-router';
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
  // Resolved on the server for every request: the same image then works in
  // development, staging and production without being rebuilt, and a missing
  // build-time variable cannot bake the wrong address into the bundle.
  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101';
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: `window.__CLE_API_URL__=${JSON.stringify(apiUrl)}` }}
        />
        {/* Telegram injects window.Telegram.WebApp; the app also runs in a plain browser for development. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <SessionProvider>
          <StartPayloadRouter />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
