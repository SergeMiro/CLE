'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '../lib/session';

const TABS = [
  { href: '/', label: 'Home', glyph: '◎' },
  { href: '/learn', label: 'Learn', glyph: '✎' },
  { href: '/communities', label: 'Communities', glyph: '❖' },
  { href: '/rewards', label: 'Rewards', glyph: '◈' },
  { href: '/wallet', label: 'Wallet', glyph: '◇' },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={pathname === tab.href ? 'active' : ''}>
          <span className="glyph">{tab.glyph}</span>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <div className="subtitle">{subtitle}</div> : null}
      </div>
      {action}
    </header>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton" key={index} />
      ))}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return <div className="notice error">{message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card center muted">{children}</div>;
}

/**
 * Every page is behind the Telegram session. Outside Telegram the app explains
 * how to open it, rather than silently rendering an empty shell.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status, error } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'error') return <ErrorNotice message={error ?? 'Could not sign in'} />;
  if (status === 'anonymous') {
    return (
      <div className="card">
        <h2>Open CLE from Telegram</h2>
        <p className="muted small">
          This Mini App authenticates with the Telegram account that opened it. Open it from the CLE bot, or, during local
          development, append <span className="mono">?mockUser=&lt;telegram id&gt;</span> to the address.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
