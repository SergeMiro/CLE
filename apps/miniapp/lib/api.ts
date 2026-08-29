'use client';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

declare global {
  interface Window {
    __CLE_API_URL__?: string;
  }
}

/** Injected by the server layout at request time; the build-time value is only a fallback. */
export function apiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.__CLE_API_URL__) return window.__CLE_API_URL__;
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101';
}

const TOKEN_KEY = 'cle.session.token';

export function storedToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem(TOKEN_KEY) ?? undefined;
}

export function storeToken(token: string | undefined): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string | undefined;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.token ?? storedToken();
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? `request failed with ${response.status}`;
    throw new ApiError(response.status, payload?.error ?? 'error', message);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, token?: string) => apiRequest<T>(path, { token }),
  post: <T>(path: string, body?: unknown, token?: string) => apiRequest<T>(path, { method: 'POST', body: body ?? {}, token }),
};
