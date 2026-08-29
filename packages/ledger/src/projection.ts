import { type AccountRef, type LedgerDirection, accountKey } from './accounts.js';
import { LedgerError, type Posting } from './postings.js';

export interface ProjectedEntry {
  account: AccountRef;
  direction: LedgerDirection;
  amountNanoton: bigint;
}

export interface UserBalance {
  available: bigint;
  pending: bigint;
  locked: bigint;
  /** available + pending — what the member is told they have earned in total. */
  total: bigint;
}

function signedAmount(entry: ProjectedEntry): bigint {
  return entry.direction === 'CREDIT' ? entry.amountNanoton : -entry.amountNanoton;
}

/** balance = credits - debits, per account. */
export function projectBalances(entries: readonly ProjectedEntry[]): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const entry of entries) {
    const key = accountKey(entry.account);
    balances.set(key, (balances.get(key) ?? 0n) + signedAmount(entry));
  }
  return balances;
}

export function balanceOf(entries: readonly ProjectedEntry[], account: AccountRef): bigint {
  return projectBalances(entries).get(accountKey(account)) ?? 0n;
}

export function userBalance(entries: readonly ProjectedEntry[], userId: string): UserBalance {
  const balances = projectBalances(entries);
  const available = balances.get(`USER_AVAILABLE:${userId}`) ?? 0n;
  const pending = balances.get(`USER_PENDING:${userId}`) ?? 0n;
  const locked = balances.get(`USER_LOCKED:${userId}`) ?? 0n;
  return { available, pending, locked, total: available + pending };
}

/** The whole ledger must net to zero; anything else means value was created or destroyed. */
export function assertLedgerIsBalanced(entries: readonly ProjectedEntry[]): void {
  const total = entries.reduce((sum, entry) => sum + signedAmount(entry), 0n);
  if (total !== 0n) throw new LedgerError(`ledger does not balance: net ${total} nanoton`);
}

/** No account that holds custody may go negative; only REVENUE_SOURCE and EXTERNAL_TON legitimately do. */
export function assertNoNegativeCustody(entries: readonly ProjectedEntry[]): void {
  for (const [key, balance] of projectBalances(entries)) {
    const [type] = key.split(':');
    if (type === 'REVENUE_SOURCE' || type === 'EXTERNAL_TON') continue;
    if (balance < 0n) throw new LedgerError(`account ${key} has a negative balance of ${balance} nanoton`);
  }
}

export function postingsToEntries(postings: readonly Posting[]): ProjectedEntry[] {
  return postings.map((posting) => ({
    account: posting.account,
    direction: posting.direction,
    amountNanoton: posting.amountNanoton,
  }));
}
