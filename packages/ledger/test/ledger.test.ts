import { describe, expect, it } from 'vitest';
import { parseTon } from '@cle/core';
import {
  LedgerError,
  adjustmentTransaction,
  assertBalanced,
  assertLedgerIsBalanced,
  assertNoNegativeCustody,
  balanceOf,
  communityAccount,
  externalTon,
  organizationAccount,
  platformTreasury,
  postingsToEntries,
  projectBalances,
  revenueSplitTransaction,
  rewardCancelTransaction,
  rewardPendingTransaction,
  rewardUnlockTransaction,
  userAccount,
  userBalance,
  withdrawalCompleteTransaction,
  withdrawalLockTransaction,
  withdrawalReleaseTransaction,
  type LedgerTransactionDraft,
  type ProjectedEntry,
} from '../src/index.js';

const COMMUNITY = 'community-1';
const ORGANIZATION = 'org-1';
const USER = 'user-1';

function entriesOf(...drafts: LedgerTransactionDraft[]): ProjectedEntry[] {
  return drafts.flatMap((draft) => postingsToEntries(draft.postings));
}

describe('transaction construction', () => {
  it('produces a balanced revenue split', () => {
    const draft = revenueSplitTransaction({
      revenueCycleId: 'cycle-1',
      communityId: COMMUNITY,
      organizationId: ORGANIZATION,
      platformFeeNanoton: parseTon('10'),
      creatorShareNanoton: parseTon('4.5'),
      communityShareNanoton: parseTon('85.5'),
    });
    expect(() => assertBalanced(draft)).not.toThrow();
    expect(draft.reference).toBe('revenue-split:cycle-1');
    const balances = projectBalances(postingsToEntries(draft.postings));
    expect(balances.get('REVENUE_SOURCE:community-1')).toBe(parseTon('-100'));
    expect(balances.get('PLATFORM_TREASURY:-')).toBe(parseTon('10'));
    expect(balances.get('CREATOR_BALANCE:org-1')).toBe(parseTon('4.5'));
    expect(balances.get('COMMUNITY_TREASURY:community-1')).toBe(parseTon('85.5'));
  });

  it('omits zero legs when the creator takes no share', () => {
    const draft = revenueSplitTransaction({
      revenueCycleId: 'cycle-2',
      communityId: COMMUNITY,
      organizationId: ORGANIZATION,
      platformFeeNanoton: parseTon('10'),
      creatorShareNanoton: 0n,
      communityShareNanoton: parseTon('90'),
    });
    expect(draft.postings).toHaveLength(3);
  });

  it('refuses a split of zero', () => {
    expect(() =>
      revenueSplitTransaction({
        revenueCycleId: 'cycle-3',
        communityId: COMMUNITY,
        organizationId: ORGANIZATION,
        platformFeeNanoton: 0n,
        creatorShareNanoton: 0n,
        communityShareNanoton: 0n,
      }),
    ).toThrow(LedgerError);
  });

  it('rejects an unbalanced draft', () => {
    expect(() =>
      assertBalanced({
        kind: 'ADMIN_ADJUSTMENT',
        reference: 'broken',
        postings: [
          { account: platformTreasury(), direction: 'DEBIT', amountNanoton: 5n },
          { account: externalTon(), direction: 'CREDIT', amountNanoton: 4n },
        ],
      }),
    ).toThrow(/unbalanced/);
  });

  it('rejects a non-positive posting', () => {
    expect(() =>
      assertBalanced({
        kind: 'ADMIN_ADJUSTMENT',
        reference: 'zero',
        postings: [
          { account: platformTreasury(), direction: 'DEBIT', amountNanoton: 0n },
          { account: externalTon(), direction: 'CREDIT', amountNanoton: 0n },
        ],
      }),
    ).toThrow(/non-positive/);
  });

  it('rejects a scoped account without an owner', () => {
    expect(() =>
      assertBalanced({
        kind: 'ADMIN_ADJUSTMENT',
        reference: 'ownerless',
        postings: [
          { account: { type: 'USER_AVAILABLE', ownerId: null }, direction: 'DEBIT', amountNanoton: 1n },
          { account: externalTon(), direction: 'CREDIT', amountNanoton: 1n },
        ],
      }),
    ).toThrow(/requires an ownerId/);
  });

  it('rejects an adjustment onto the same account', () => {
    expect(() =>
      adjustmentTransaction({
        reference: 'self',
        from: platformTreasury(),
        to: platformTreasury(),
        amountNanoton: 1n,
        reason: 'test',
      }),
    ).toThrow(LedgerError);
  });

  it('derives a stable reference per business event', () => {
    const first = rewardPendingTransaction({ allocationId: 'a-1', communityId: COMMUNITY, userId: USER, amountNanoton: 5n });
    const second = rewardPendingTransaction({ allocationId: 'a-1', communityId: COMMUNITY, userId: USER, amountNanoton: 5n });
    expect(first.reference).toBe(second.reference);
  });
});

describe('reward and withdrawal lifecycle', () => {
  it('moves money from revenue to an external payout without losing a nanoton', () => {
    const reward = parseTon('2');
    const ledger = entriesOf(
      revenueSplitTransaction({
        revenueCycleId: 'cycle-1',
        communityId: COMMUNITY,
        organizationId: ORGANIZATION,
        platformFeeNanoton: parseTon('10'),
        creatorShareNanoton: parseTon('4.5'),
        communityShareNanoton: parseTon('85.5'),
      }),
      rewardPendingTransaction({ allocationId: 'a-1', communityId: COMMUNITY, userId: USER, amountNanoton: reward }),
      rewardUnlockTransaction({ allocationId: 'a-1', communityId: COMMUNITY, userId: USER, amountNanoton: reward }),
      withdrawalLockTransaction({ withdrawalId: 'w-1', subject: { type: 'USER', userId: USER }, amountNanoton: reward }),
      withdrawalCompleteTransaction({ withdrawalId: 'w-1', subject: { type: 'USER', userId: USER }, amountNanoton: reward }),
    );

    assertLedgerIsBalanced(ledger);
    assertNoNegativeCustody(ledger);
    expect(userBalance(ledger, USER)).toEqual({ available: 0n, pending: 0n, locked: 0n, total: 0n });
    expect(balanceOf(ledger, communityAccount('COMMUNITY_TREASURY', COMMUNITY))).toBe(parseTon('83.5'));
    expect(balanceOf(ledger, externalTon())).toBe(reward);
  });

  it('returns a cancelled reward to the community treasury', () => {
    const ledger = entriesOf(
      revenueSplitTransaction({
        revenueCycleId: 'cycle-1',
        communityId: COMMUNITY,
        organizationId: ORGANIZATION,
        platformFeeNanoton: 1n,
        creatorShareNanoton: 0n,
        communityShareNanoton: parseTon('10'),
      }),
      rewardPendingTransaction({ allocationId: 'a-1', communityId: COMMUNITY, userId: USER, amountNanoton: parseTon('3') }),
      rewardCancelTransaction({ allocationId: 'a-1', communityId: COMMUNITY, userId: USER, amountNanoton: parseTon('3') }),
    );
    assertLedgerIsBalanced(ledger);
    assertNoNegativeCustody(ledger);
    expect(balanceOf(ledger, communityAccount('COMMUNITY_TREASURY', COMMUNITY))).toBe(parseTon('10'));
    expect(userBalance(ledger, USER).total).toBe(0n);
  });

  it('releases a failed withdrawal back to the available balance', () => {
    const amount = parseTon('1');
    const ledger = entriesOf(
      revenueSplitTransaction({
        revenueCycleId: 'cycle-1',
        communityId: COMMUNITY,
        organizationId: ORGANIZATION,
        platformFeeNanoton: 1n,
        creatorShareNanoton: 0n,
        communityShareNanoton: parseTon('10'),
      }),
      rewardPendingTransaction({ allocationId: 'a-1', communityId: COMMUNITY, userId: USER, amountNanoton: amount }),
      rewardUnlockTransaction({ allocationId: 'a-1', communityId: COMMUNITY, userId: USER, amountNanoton: amount }),
      withdrawalLockTransaction({ withdrawalId: 'w-1', subject: { type: 'USER', userId: USER }, amountNanoton: amount }),
      withdrawalReleaseTransaction({ withdrawalId: 'w-1', subject: { type: 'USER', userId: USER }, amountNanoton: amount }),
    );
    assertLedgerIsBalanced(ledger);
    expect(userBalance(ledger, USER)).toEqual({ available: amount, pending: 0n, locked: 0n, total: amount });
  });

  it('pays a creator out of the organization balance', () => {
    const amount = parseTon('4.5');
    const ledger = entriesOf(
      revenueSplitTransaction({
        revenueCycleId: 'cycle-1',
        communityId: COMMUNITY,
        organizationId: ORGANIZATION,
        platformFeeNanoton: parseTon('10'),
        creatorShareNanoton: amount,
        communityShareNanoton: parseTon('85.5'),
      }),
      withdrawalLockTransaction({ withdrawalId: 'w-2', subject: { type: 'ORGANIZATION', organizationId: ORGANIZATION }, amountNanoton: amount }),
      withdrawalCompleteTransaction({ withdrawalId: 'w-2', subject: { type: 'ORGANIZATION', organizationId: ORGANIZATION }, amountNanoton: amount }),
    );
    assertLedgerIsBalanced(ledger);
    assertNoNegativeCustody(ledger);
    expect(balanceOf(ledger, organizationAccount('CREATOR_BALANCE', ORGANIZATION))).toBe(0n);
    expect(balanceOf(ledger, externalTon())).toBe(amount);
  });

  it('keeps two organizations accounted for separately', () => {
    const ledger = entriesOf(
      revenueSplitTransaction({
        revenueCycleId: 'cycle-a',
        communityId: 'community-a',
        organizationId: 'org-a',
        platformFeeNanoton: parseTon('1'),
        creatorShareNanoton: parseTon('0.9'),
        communityShareNanoton: parseTon('8.1'),
      }),
      revenueSplitTransaction({
        revenueCycleId: 'cycle-b',
        communityId: 'community-b',
        organizationId: 'org-b',
        platformFeeNanoton: parseTon('2'),
        creatorShareNanoton: parseTon('1.8'),
        communityShareNanoton: parseTon('16.2'),
      }),
    );
    expect(balanceOf(ledger, organizationAccount('CREATOR_BALANCE', 'org-a'))).toBe(parseTon('0.9'));
    expect(balanceOf(ledger, organizationAccount('CREATOR_BALANCE', 'org-b'))).toBe(parseTon('1.8'));
    expect(balanceOf(ledger, platformTreasury())).toBe(parseTon('3'));
    assertLedgerIsBalanced(ledger);
  });

  it('detects a negative custody balance', () => {
    const ledger = entriesOf(
      withdrawalLockTransaction({ withdrawalId: 'w-3', subject: { type: 'USER', userId: USER }, amountNanoton: parseTon('5') }),
    );
    expect(() => assertNoNegativeCustody(ledger)).toThrow(/negative balance/);
    assertLedgerIsBalanced(ledger);
  });

  it('reports an unbalanced ledger', () => {
    expect(() =>
      assertLedgerIsBalanced([{ account: userAccount('USER_AVAILABLE', USER), direction: 'CREDIT', amountNanoton: 1n }]),
    ).toThrow(/does not balance/);
  });
});
