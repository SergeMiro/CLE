'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { openLink } from '../lib/telegram';
import { ChevronIcon } from './icons';

export interface QuizAd {
  id: string;
  sponsor: string;
  headline: string;
  body: string | null;
  ctaLabel: string | null;
  url: string;
}

/**
 * The sponsored strip inside a quiz. Deliberately the quietest block on the
 * screen: a hairline frame with the word ADS sitting on it, no brand gradient
 * and no fill, so it reads as bought space rather than as something CLE is
 * telling the reader to do.
 *
 * The impression is counted when the strip is actually on screen, not when it
 * renders — an advertiser is billed for a view, and the quiz is long enough
 * that a strip can be rendered and never seen.
 */
export function AdSlot({ ad }: { ad: QuizAd }) {
  const { token } = useSession();
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || seen || !token) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      void api.post(`/api/v1/ads/${ad.id}/impression`, {}, token).catch(() => undefined);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setSeen(true);
        // Counting must never delay or break the quiz.
        void api.post(`/api/v1/ads/${ad.id}/impression`, {}, token).catch(() => undefined);
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ad.id, seen, token]);

  return (
    <button
      type="button"
      ref={ref}
      className="ad-slot"
      onClick={() => {
        void api.post(`/api/v1/ads/${ad.id}/click`, {}, token).catch(() => undefined);
        openLink(ad.url);
      }}
    >
      <span className="ad-tag">ads</span>
      <span className="ad-body">
        <span className="ad-headline">{ad.headline}</span>
        <span className="ad-sub">{ad.body ? `${ad.body} · ${ad.sponsor}` : ad.sponsor}</span>
      </span>
      <span className="ad-cta">
        {ad.ctaLabel ? <span>{ad.ctaLabel}</span> : null}
        <ChevronIcon width={16} height={16} />
      </span>
    </button>
  );
}
