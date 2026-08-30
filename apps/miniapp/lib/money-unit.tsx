'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { OTHER_UNIT, type MoneyUnit } from './money';

const STORAGE_KEY = 'cle.money-unit';

interface MoneyUnitState {
  unit: MoneyUnit;
  other: MoneyUnit;
  setUnit: (unit: MoneyUnit) => void;
  toggle: () => void;
}

const MoneyUnitContext = createContext<MoneyUnitState | undefined>(undefined);

function stored(): MoneyUnit | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'TON' || value === 'CLEP' ? value : undefined;
  } catch {
    // A browser with site data switched off still has to render a balance.
    return undefined;
  }
}

/**
 * Which unit the app writes money in. CLEP first, because a reward reads as a
 * number worth having rather than as 0.037; TON is never far away, because it
 * is the money that actually leaves for a wallet.
 */
export function MoneyUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<MoneyUnit>('CLEP');

  // Read after mount: the server has no idea what this person chose, and
  // rendering their choice straight away would not match the HTML it sent.
  useEffect(() => {
    const saved = stored();
    if (saved) setUnitState(saved);
  }, []);

  const setUnit = useCallback((next: MoneyUnit) => {
    setUnitState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice then lasts for this visit only, which is good enough.
    }
  }, []);

  const value = useMemo<MoneyUnitState>(
    () => ({ unit, other: OTHER_UNIT[unit], setUnit, toggle: () => setUnit(OTHER_UNIT[unit]) }),
    [setUnit, unit],
  );
  return <MoneyUnitContext.Provider value={value}>{children}</MoneyUnitContext.Provider>;
}

export function useMoneyUnit(): MoneyUnitState {
  const context = useContext(MoneyUnitContext);
  if (!context) throw new Error('useMoneyUnit must be used inside MoneyUnitProvider');
  return context;
}
