'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  CommunitiesIcon,
  HomeIcon,
  InboxIcon,
  LearnIcon,
  RewardsIcon,
  WalletIcon,
} from './icons';
import { useSession } from '../lib/session';

const TABS = [
  { href: '/', label: 'Home', Icon: HomeIcon },
  { href: '/learn', label: 'Learn', Icon: LearnIcon },
  { href: '/communities', label: 'Communities', Icon: CommunitiesIcon },
  { href: '/rewards', label: 'Rewards', Icon: RewardsIcon },
  { href: '/wallet', label: 'Wallet', Icon: WalletIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {TABS.map(({ href, label, Icon }) => {
        // A quiz belongs to Learn and a community page to Circles: the tab a
        // person navigated through should stay lit while they are inside it.
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href) || (href === '/learn' && pathname.startsWith('/quiz'));
        return (
          <Link key={href} href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
            <Icon />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The circle in the top right is the way into the profile, which has no tab. */
function AvatarLink() {
  const { user, status } = useSession();
  if (status !== 'ready' || !user) return null;
  const seed = user.firstName ?? user.username ?? '?';
  return (
    <Link href="/profile" className="avatar" aria-label="Profile">
      {seed.slice(0, 1).toUpperCase()}
    </Link>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <div className="subtitle">{subtitle}</div> : null}
      </div>
      {action ?? <AvatarLink />}
    </header>
  );
}

export function Loading({ rows = 3, hero = false }: { rows?: number; hero?: boolean }) {
  return (
    <div>
      {hero ? <div className="skeleton tall" /> : null}
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton" key={index} />
      ))}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return <div className="notice error">{message}</div>;
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card empty">
      <div className="glyph">{icon ?? <InboxIcon />}</div>
      <p>{children}</p>
    </div>
  );
}

/**
 * Every page is behind the Telegram session. Outside Telegram the app explains
 * how to open it, rather than silently rendering an empty shell.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status, error } = useSession();
  if (status === 'loading') return <Loading hero />;
  if (status === 'error') return <ErrorNotice message={error ?? 'Could not sign in'} />;
  if (status === 'anonymous') {
    return (
      <div className="card empty">
        <div className="glyph">
          <InboxIcon />
        </div>
        <h3 style={{ marginBottom: 6 }}>Open CLE from Telegram</h3>
        <p>This Mini App signs in with the Telegram account that opened it. Launch it from the CLE bot.</p>
        {/* The development shortcut only exists in a mock build, so production never advertises it. */}
        {process.env.NODE_ENV === 'production' ? null : (
          <p className="mt">
            In local development, append <span className="mono">?mockUser=&lt;telegram id&gt;</span> to the address.
          </p>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
