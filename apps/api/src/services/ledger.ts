import type { LedgerAccount, Prisma } from '@cle/db';
import {
  type AccountRef,
  type LedgerTransactionDraft,
  accountLabel,
  assertBalanced,
  externalTon,
  organizationAccount,
  platformTreasury,
  communityAccount,
  userAccount,
} from '@cle/ledger';
import type { AppContext } from '../context.js';

export type Tx = Prisma.TransactionClient;

/** The platform-wide accounts have no owner; the column stores a literal instead of NULL. */
const PLATFORM_OWNER = 'platform';

function ownerColumn(ref: AccountRef): string {
  return ref.ownerId ?? PLATFORM_OWNER;
}

async function ensureAccount(tx: Tx, ref: AccountRef): Promise<LedgerAccount> {
  const where = { type_ownerId: { type: ref.type, ownerId: ownerColumn(ref) } };
  const existing = await tx.ledgerAccount.findUnique({ where });
  if (existing) return existing;
  return tx.ledgerAccount.create({ data: { type: ref.type, ownerId: ownerColumn(ref), label: accountLabel(ref) } });
}

export interface PostedTransaction {
  id: string;
  reference: string;
  /** False when the same reference had already been posted, so nothing was written twice. */
  created: boolean;
}

/**
 * Appends one balanced transaction. The reference is unique, so replaying the
 * same business event is a no-op rather than a double payment. Entries are
 * never updated or deleted afterwards.
 */
export async function postTransaction(tx: Tx, draft: LedgerTransactionDraft): Promise<PostedTransaction> {
  assertBalanced(draft);
  const existing = await tx.ledgerTransaction.findUnique({ where: { reference: draft.reference }, select: { id: true } });
  if (existing) return { id: existing.id, reference: draft.reference, created: false };

  const accounts = new Map<string, LedgerAccount>();
  for (const posting of draft.postings) {
    const key = `${posting.account.type}:${posting.account.ownerId ?? '-'}`;
    if (!accounts.has(key)) accounts.set(key, await ensureAccount(tx, posting.account));
  }

  const transaction = await tx.ledgerTransaction.create({
    data: {
      kind: draft.kind,
      reference: draft.reference,
      metadata: (draft.metadata ?? null) as never,
      entries: {
        create: draft.postings.map((posting) => ({
          accountId: accounts.get(`${posting.account.type}:${posting.account.ownerId ?? '-'}`)!.id,
          direction: posting.direction,
          amountNanoton: posting.amountNanoton,
        })),
      },
    },
    select: { id: true },
  });
  return { id: transaction.id, reference: draft.reference, created: true };
}

async function balanceOfAccounts(client: Tx, accountIds: string[]): Promise<Map<string, bigint>> {
  if (accountIds.length === 0) return new Map();
  const grouped = await client.ledgerEntry.groupBy({
    by: ['accountId', 'direction'],
    where: { accountId: { in: accountIds } },
    _sum: { amountNanoton: true },
  });
  const balances = new Map<string, bigint>();
  for (const row of grouped) {
    const amount = row._sum.amountNanoton ?? 0n;
    const signed = row.direction === 'CREDIT' ? amount : -amount;
    balances.set(row.accountId, (balances.get(row.accountId) ?? 0n) + signed);
  }
  return balances;
}

export async function accountBalance(client: Tx, ref: AccountRef): Promise<bigint> {
  const account = await client.ledgerAccount.findUnique({
    where: { type_ownerId: { type: ref.type, ownerId: ownerColumn(ref) } },
    select: { id: true },
  });
  if (!account) return 0n;
  return (await balanceOfAccounts(client, [account.id])).get(account.id) ?? 0n;
}

export interface UserBalances {
  available: bigint;
  pending: bigint;
  locked: bigint;
  total: bigint;
}

export async function userBalances(client: Tx, userId: string): Promise<UserBalances> {
  const accounts = await client.ledgerAccount.findMany({
    where: { ownerId: userId, type: { in: ['USER_AVAILABLE', 'USER_PENDING', 'USER_LOCKED'] } },
    select: { id: true, type: true },
  });
  const balances = await balanceOfAccounts(client, accounts.map((account) => account.id));
  const of = (type: string): bigint => {
    const account = accounts.find((candidate) => candidate.type === type);
    return account ? balances.get(account.id) ?? 0n : 0n;
  };
  const available = of('USER_AVAILABLE');
  const pending = of('USER_PENDING');
  const locked = of('USER_LOCKED');
  return { available, pending, locked, total: available + pending };
}

export async function organizationBalances(client: Tx, organizationId: string): Promise<{ available: bigint; locked: bigint }> {
  return {
    available: await accountBalance(client, organizationAccount('CREATOR_BALANCE', organizationId)),
    locked: await accountBalance(client, organizationAccount('ORGANIZATION_TREASURY', organizationId)),
  };
}

export async function communityTreasuryBalance(client: Tx, communityId: string): Promise<bigint> {
  return accountBalance(client, communityAccount('COMMUNITY_TREASURY', communityId));
}

export async function platformTreasuryBalance(client: Tx): Promise<bigint> {
  return accountBalance(client, platformTreasury());
}

export interface LedgerHealth {
  netNanoton: bigint;
  balanced: boolean;
  negativeCustodyAccounts: { account: string; balanceNanoton: bigint }[];
}

/** Whole-ledger invariant check, used by the admin dashboard and the test suite. */
export async function checkLedgerHealth(ctx: AppContext): Promise<LedgerHealth> {
  const accounts = await ctx.prisma.ledgerAccount.findMany({ select: { id: true, type: true, label: true } });
  const balances = await balanceOfAccounts(ctx.prisma, accounts.map((account) => account.id));
  let net = 0n;
  const negative: { account: string; balanceNanoton: bigint }[] = [];
  for (const account of accounts) {
    const balance = balances.get(account.id) ?? 0n;
    net += balance;
    if (balance < 0n && account.type !== 'REVENUE_SOURCE' && account.type !== 'EXTERNAL_TON') {
      negative.push({ account: account.label, balanceNanoton: balance });
    }
  }
  return { netNanoton: net, balanced: net === 0n, negativeCustodyAccounts: negative };
}

export const accounts = { platformTreasury, externalTon, communityAccount, organizationAccount, userAccount };
