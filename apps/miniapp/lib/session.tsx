'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, storeToken, storedToken } from './api';
import { credentials, expectedTelegramId, isInsideTelegram, webApp } from './telegram';

export interface CleUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  referralCode: string;
  learningPoints: number;
  isPlatformAdmin: boolean;
  isCreator: boolean;
}

export interface StartPayload {
  kind: 'community' | 'quiz' | 'referral';
  communityId?: string;
  quizId?: string;
  referralCode?: string;
}

interface SessionState {
  user: CleUser | undefined;
  token: string | undefined;
  status: 'loading' | 'ready' | 'anonymous' | 'error';
  error: string | undefined;
  startPayload: StartPayload | undefined;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CleUser>();
  const [token, setToken] = useState<string>();
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [error, setError] = useState<string>();
  const [startPayload, setStartPayload] = useState<StartPayload>();

  const loadUser = useCallback(async (sessionToken: string): Promise<CleUser> => {
    const profile = await api.get<CleUser>('/api/v1/me', sessionToken);
    setUser(profile);
    setToken(sessionToken);
    setStatus('ready');
    return profile;
  }, []);

  const authenticate = useCallback(async () => {
    setStatus('loading');
    setError(undefined);
    try {
      const expected = expectedTelegramId();
      const existing = storedToken();
      if (existing) {
        try {
          const profile = await loadUser(existing);
          // Reuse the session only if it belongs to the account opening the app.
          if (!expected || profile.telegramId === expected) return;
          storeToken(undefined);
          setUser(undefined);
          setToken(undefined);
        } catch (cause) {
          // An expired or revoked token simply means signing in again.
          if (!(cause instanceof ApiError) || cause.status !== 401) throw cause;
          storeToken(undefined);
        }
      }

      const credential = credentials();
      if (!credential) {
        setStatus('anonymous');
        return;
      }
      const result = await api.post<{ token: string; user: CleUser; startPayload: StartPayload | null }>(
        '/api/v1/auth/telegram',
        credential,
      );
      storeToken(result.token);
      setStartPayload(result.startPayload ?? undefined);
      setUser(result.user);
      setToken(result.token);
      setStatus('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('error');
    }
  }, [loadUser]);

  useEffect(() => {
    webApp()?.ready();
    webApp()?.expand();
    void authenticate();
  }, [authenticate]);

  const value = useMemo<SessionState>(
    () => ({
      user,
      token,
      status,
      error,
      startPayload,
      refresh: async () => {
        if (token) await loadUser(token);
      },
      signOut: async () => {
        if (token) await api.post('/api/v1/auth/logout', {}, token).catch(() => undefined);
        storeToken(undefined);
        setUser(undefined);
        setToken(undefined);
        setStatus('anonymous');
      },
    }),
    [user, token, status, error, startPayload, loadUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}

export function useInsideTelegram(): boolean {
  const [inside, setInside] = useState(false);
  useEffect(() => setInside(isInsideTelegram()), []);
  return inside;
}
