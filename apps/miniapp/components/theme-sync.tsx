'use client';

import { useEffect } from 'react';
import { syncColorScheme } from '../lib/telegram';

/** Keeps the page, the Telegram header and the app's own palette in one theme. */
export function ThemeSync() {
  useEffect(() => syncColorScheme(), []);
  return null;
}
