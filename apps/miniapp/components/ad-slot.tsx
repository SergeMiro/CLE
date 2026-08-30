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
  imageUrl: string | null;
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
  // A creative is hosted by the advertiser, so it can 404 or be pulled at any
  // time. The strip has to read correctly without it rather than show a gap.
  const [imageBroken, setImageBroken] = useState(false);
  const image = imageBroken ? undefined : (ad.imageUrl ?? undefined);

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
      {image ? (
        // A plain img, not next/image: the host is whatever the advertiser
        // supplied, and it must not need a build-time allowlist to appear.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="ad-image"
          src={image}
          alt=""
          width={46}
          height={46}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageBroken(true)}
        />
      ) : null}
      <span className="ad-body">
        <span className="ad-headline">{ad.headline}</span>
        <span className="ad-sub">{ad.body ? `${ad.body} · ${ad.sponsor}` : ad.sponsor}</span>
      </span>
      <span className="ad-cta">
        {/* With a creative there is no room for both on a phone, and the image
            is the draw — the whole strip is clickable either way. */}
        {ad.ctaLabel && !image ? <span>{ad.ctaLabel}</span> : null}
        <ChevronIcon width={16} height={16} />
      </span>
    </button>
  );
}
