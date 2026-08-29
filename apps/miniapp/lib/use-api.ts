'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useSession } from './session';

export interface Query<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/** Minimal data hook: fetch on mount, refetch on demand, no cache to go stale. */
export function useApi<T>(path: string | undefined): Query<T> {
  const { token, status } = useSession();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path || status !== 'ready' || !token) return;
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(path, token)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, token, status, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}
