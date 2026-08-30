'use client';

import { formatMoney, type MoneyUnit } from '../lib/money';
import { useMoneyUnit } from '../lib/money-unit';
import { haptic } from '../lib/telegram';

interface AmountProps {
  nanoton: string | bigint | undefined | null;
  /** Long balances get shorter TON forms; 4 digits is the default elsewhere. */
  tonFractionDigits?: number;
  /** Renders in one fixed unit, whatever the person chose. */
  unit?: MoneyUnit;
  withUnit?: boolean;
}

/** One amount, written in the unit the person is reading the app in. */
export function Money({ nanoton, tonFractionDigits = 4, unit, withUnit = true }: AmountProps) {
  const { unit: preferred } = useMoneyUnit();
  const shown = unit ?? preferred;
  return (
    <>
      {formatMoney(nanoton, shown, tonFractionDigits)}
      {withUnit ? <span className="unit-suffix"> {shown}</span> : null}
    </>
  );
}

/**
 * The headline balance. It carries the other unit underneath — the money is
 * real, and hiding what it is worth in TON would make it read like scrip — and
 * tapping either one swaps them.
 */
export function MoneyHero({ nanoton, eyebrow }: { nanoton: string | bigint | undefined | null; eyebrow: string }) {
  const { unit, other, toggle } = useMoneyUnit();
  return (
    <>
      <div className="eyebrow">{eyebrow}</div>
      <button
        type="button"
        className="amount amount-switch"
        onClick={() => {
          haptic('light');
          toggle();
        }}
        aria-label={`Shown in ${unit}. Tap to show ${other}.`}
      >
        {formatMoney(nanoton, unit, 4)}
        <span className="unit">{unit}</span>
      </button>
      <div className="amount-alt">
        ≈ {formatMoney(nanoton, other, 4)} {other}
        <span className="amount-alt-hint">tap to switch</span>
      </div>
    </>
  );
}
