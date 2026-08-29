'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSession } from '../lib/session';

/**
 * A quiz card in a channel links to t.me/<bot>?startapp=q_<id>. Telegram opens
 * the Mini App and hands the payload over; this takes the person to what they
 * actually tapped instead of leaving them on the home screen.
 */
export function StartPayloadRouter() {
  const { startPayload, status } = useSession();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (status !== 'ready' || handled.current || !startPayload) return;
    handled.current = true;
    if (startPayload.kind === 'quiz' && startPayload.quizId) router.replace(`/quiz/${startPayload.quizId}`);
    else if (startPayload.kind === 'community' && startPayload.communityId) router.replace(`/communities/${startPayload.communityId}`);
    // A referral payload is attributed server-side at sign-in; the home screen is the right landing.
  }, [startPayload, status, router]);

  return null;
}
