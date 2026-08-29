/**
 * Every account holds value under one convention: balance = credits - debits.
 *
 *   REVENUE_SOURCE          origin of channel revenue; goes negative as money enters the system
 *   PLATFORM_TREASURY       the CLE fee
 *   CREATOR_BALANCE         organization funds available to withdraw
 *   ORGANIZATION_TREASURY   organization funds locked in an in-flight withdrawal
 *   COMMUNITY_TREASURY      the community share, waiting to be allocated as rewards
 *   USER_PENDING            allocated to a member but still on hold
 *   USER_AVAILABLE          withdrawable member balance
 *   USER_LOCKED             member funds locked in an in-flight withdrawal
 *   EXTERNAL_TON            money that has left CLE custody on-chain
 *
 * The sum of all account balances is always zero.
 */
export type LedgerAccountType =
  | 'PLATFORM_TREASURY'
  | 'ORGANIZATION_TREASURY'
  | 'COMMUNITY_TREASURY'
  | 'CREATOR_BALANCE'
  | 'USER_AVAILABLE'
  | 'USER_PENDING'
  | 'USER_LOCKED'
  | 'REVENUE_SOURCE'
  | 'EXTERNAL_TON';

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export type LedgerTransactionKind =
  | 'REVENUE_FUNDED'
  | 'REVENUE_SPLIT'
  | 'REWARD_PENDING'
  | 'REWARD_UNLOCK'
  | 'REWARD_CANCEL'
  | 'WITHDRAWAL_LOCK'
  | 'WITHDRAWAL_COMPLETE'
  | 'WITHDRAWAL_RELEASE'
  | 'ADMIN_ADJUSTMENT';

export interface AccountRef {
  type: LedgerAccountType;
  /** Organization, community or user id; null for the single platform-wide accounts. */
  ownerId: string | null;
}

const SINGLETON_ACCOUNTS: ReadonlySet<LedgerAccountType> = new Set(['PLATFORM_TREASURY', 'EXTERNAL_TON']);

export function accountKey(ref: AccountRef): string {
  return `${ref.type}:${ref.ownerId ?? '-'}`;
}

export function platformTreasury(): AccountRef {
  return { type: 'PLATFORM_TREASURY', ownerId: null };
}

export function externalTon(): AccountRef {
  return { type: 'EXTERNAL_TON', ownerId: null };
}

export function communityAccount(type: Extract<LedgerAccountType, 'COMMUNITY_TREASURY' | 'REVENUE_SOURCE'>, communityId: string): AccountRef {
  return { type, ownerId: communityId };
}

export function organizationAccount(
  type: Extract<LedgerAccountType, 'CREATOR_BALANCE' | 'ORGANIZATION_TREASURY'>,
  organizationId: string,
): AccountRef {
  return { type, ownerId: organizationId };
}

export function userAccount(
  type: Extract<LedgerAccountType, 'USER_AVAILABLE' | 'USER_PENDING' | 'USER_LOCKED'>,
  userId: string,
): AccountRef {
  return { type, ownerId: userId };
}

export function isSingletonAccount(type: LedgerAccountType): boolean {
  return SINGLETON_ACCOUNTS.has(type);
}

export function accountLabel(ref: AccountRef): string {
  return isSingletonAccount(ref.type) ? ref.type : `${ref.type} ${ref.ownerId}`;
}
