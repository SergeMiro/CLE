import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBaseUrl } from '../lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiBaseUrl', () => {
  it('uses the address the server injected at request time', () => {
    // This is what makes one container image work in every environment.
    vi.stubGlobal('window', { __CLE_API_URL__: 'https://cle-api.example.com' });
    expect(apiBaseUrl()).toBe('https://cle-api.example.com');
  });

  it('falls back to the build-time value when nothing was injected', () => {
    vi.stubGlobal('window', {});
    expect(apiBaseUrl()).toBe(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4101');
  });

  it('works during server rendering, where there is no window', () => {
    vi.stubGlobal('window', undefined);
    expect(apiBaseUrl()).toMatch(/^https?:\/\//);
  });
});
