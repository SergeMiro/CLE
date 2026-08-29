import { assertNonNegative } from '@cle/core';
import {
  type AccountRef,
  type LedgerDirection,
  type LedgerTransactionKind,
  accountKey,
  communityAccount,
  externalTon,
  isSingletonAccount,
  organizationAccount,
  platformTreasury,
  userAccount,
} from './accounts.js';

export class LedgerError extends Error {}

export interface Posting {
  account: AccountRef;
  direction: LedgerDirection;
  amountNanoton: bigint;
}

export interface LedgerTransactionDraft {
  kind: LedgerTransactionKind;
  /** Idempotency key: replaying the same business event must produce the same reference. */
  reference: string;
  postings: Posting[];
  metadata?: Record<string, unknown>;
}

function debit(account: AccountRef, amountNanoton: bigint): Posting {
  return { account, direction: 'DEBIT', amountNanoton };
}

function credit(account: AccountRef, amountNanoton: bigint): Posting {
  return { account, direction: 'CREDIT', amountNanoton };
}

/** A transaction is only valid if it is balanced, non-empty and free of zero or negative legs. */
export function assertBalanced(draft: LedgerTransactionDraft): void {
  if (draft.postings.length < 2) throw new LedgerError(`transaction ${draft.reference} needs at least two postings`);
  if (draft.reference.trim() === '') throw new LedgerError('transaction reference must not be empty');
  let debits = 0n;
  let credits = 0n;
  for (const posting of draft.postings) {
    if (posting.amountNanoton <= 0n) throw new LedgerError(`transaction ${draft.reference} has a non-positive posting`);
    if (!isSingletonAccount(posting.account.type) && !posting.account.ownerId) {
      throw new LedgerError(`account ${posting.account.type} requires an ownerId`);
    }
    if (posting.direction === 'DEBIT') debits += posting.amountNanoton;
    else credits += posting.amountNanoton;
  }
  if (debits !== credits) {
    throw new LedgerError(`transaction ${draft.reference} is unbalanced: debits ${debits} != credits ${credits}`);
  }
}

function draft(
  kind: LedgerTransactionKind,
  reference: string,
  postings: Posting[],
  metadata?: Record<string, unknown>,
): LedgerTransactionDraft {
  const result: LedgerTransactionDraft = { kind, reference, postings, ...(metadata ? { metadata } : {}) };
  assertBalanced(result);
  return result;
}

export interface RevenueSplitPostingInput {
  revenueCycleId: string;
  communityId: string;
  organizationId: string;
  platformFeeNanoton: bigint;
  creatorShareNanoton: bigint;
  communityShareNanoton: bigint;
}

/** gross leaves REVENUE_SOURCE and lands in the platform, creator and community accounts. */
export function revenueSplitTransaction(input: RevenueSplitPostingInput): LedgerTransactionDraft {
  const gross = input.platformFeeNanoton + input.creatorShareNanoton + input.communityShareNanoton;
  assertNonNegative(gross, 'gross');
  if (gross === 0n) throw new LedgerError('a revenue split of zero cannot be posted');
  const postings: Posting[] = [debit(communityAccount('REVENUE_SOURCE', input.communityId), gross)];
  if (input.platformFeeNanoton > 0n) postings.push(credit(platformTreasury(), input.platformFeeNanoton));
  if (input.creatorShareNanoton > 0n) {
    postings.push(credit(organizationAccount('CREATOR_BALANCE', input.organizationId), input.creatorShareNanoton));
  }
  if (input.communityShareNanoton > 0n) {
    postings.push(credit(communityAccount('COMMUNITY_TREASURY', input.communityId), input.communityShareNanoton));
  }
  return draft('REVENUE_SPLIT', `revenue-split:${input.revenueCycleId}`, postings, {
    communityId: input.communityId,
    organizationId: input.organizationId,
  });
}

export interface AllocationPostingInput {
  allocationId: string;
  communityId: string;
  userId: string;
  amountNanoton: bigint;
}

export function rewardPendingTransaction(input: AllocationPostingInput): LedgerTransactionDraft {
  return draft(
    'REWARD_PENDING',
    `reward-pending:${input.allocationId}`,
    [
      debit(communityAccount('COMMUNITY_TREASURY', input.communityId), input.amountNanoton),
      credit(userAccount('USER_PENDING', input.userId), input.amountNanoton),
    ],
    { allocationId: input.allocationId, communityId: input.communityId },
  );
}

export function rewardUnlockTransaction(input: AllocationPostingInput): LedgerTransactionDraft {
  return draft(
    'REWARD_UNLOCK',
    `reward-unlock:${input.allocationId}`,
    [
      debit(userAccount('USER_PENDING', input.userId), input.amountNanoton),
      credit(userAccount('USER_AVAILABLE', input.userId), input.amountNanoton),
    ],
    { allocationId: input.allocationId, communityId: input.communityId },
  );
}

export function rewardCancelTransaction(input: AllocationPostingInput): LedgerTransactionDraft {
  return draft(
    'REWARD_CANCEL',
    `reward-cancel:${input.allocationId}`,
    [
      debit(userAccount('USER_PENDING', input.userId), input.amountNanoton),
      credit(communityAccount('COMMUNITY_TREASURY', input.communityId), input.amountNanoton),
    ],
    { allocationId: input.allocationId, communityId: input.communityId },
  );
}

export type WithdrawalSubject = { type: 'USER'; userId: string } | { type: 'ORGANIZATION'; organizationId: string };

export interface WithdrawalPostingInput {
  withdrawalId: string;
  subject: WithdrawalSubject;
  amountNanoton: bigint;
}

function availableAccount(subject: WithdrawalSubject): AccountRef {
  return subject.type === 'USER'
    ? userAccount('USER_AVAILABLE', subject.userId)
    : organizationAccount('CREATOR_BALANCE', subject.organizationId);
}

function lockedAccount(subject: WithdrawalSubject): AccountRef {
  return subject.type === 'USER'
    ? userAccount('USER_LOCKED', subject.userId)
    : organizationAccount('ORGANIZATION_TREASURY', subject.organizationId);
}

export function withdrawalLockTransaction(input: WithdrawalPostingInput): LedgerTransactionDraft {
  return draft(
    'WITHDRAWAL_LOCK',
    `withdrawal-lock:${input.withdrawalId}`,
    [debit(availableAccount(input.subject), input.amountNanoton), credit(lockedAccount(input.subject), input.amountNanoton)],
    { withdrawalId: input.withdrawalId },
  );
}

export function withdrawalCompleteTransaction(input: WithdrawalPostingInput): LedgerTransactionDraft {
  return draft(
    'WITHDRAWAL_COMPLETE',
    `withdrawal-complete:${input.withdrawalId}`,
    [debit(lockedAccount(input.subject), input.amountNanoton), credit(externalTon(), input.amountNanoton)],
    { withdrawalId: input.withdrawalId },
  );
}

export function withdrawalReleaseTransaction(input: WithdrawalPostingInput): LedgerTransactionDraft {
  return draft(
    'WITHDRAWAL_RELEASE',
    `withdrawal-release:${input.withdrawalId}`,
    [debit(lockedAccount(input.subject), input.amountNanoton), credit(availableAccount(input.subject), input.amountNanoton)],
    { withdrawalId: input.withdrawalId },
  );
}

export interface AdjustmentPostingInput {
  reference: string;
  from: AccountRef;
  to: AccountRef;
  amountNanoton: bigint;
  reason: string;
}

export function adjustmentTransaction(input: AdjustmentPostingInput): LedgerTransactionDraft {
  if (accountKey(input.from) === accountKey(input.to)) throw new LedgerError('an adjustment must move value between two accounts');
  return draft(
    'ADMIN_ADJUSTMENT',
    `adjustment:${input.reference}`,
    [debit(input.from, input.amountNanoton), credit(input.to, input.amountNanoton)],
    { reason: input.reason },
  );
}
