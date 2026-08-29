import { randomUUID } from 'node:crypto';
import type { Wallet } from '@cle/db';
import { type TonProof, createProofChallenge, parseTonAddress, verifyTonProof, TonProofError, TonAddressError } from '@cle/ton';
import type { AppContext } from '../context.js';
import { badRequest, unauthorized, unprocessable } from '../errors.js';
import { recordAudit } from './audit.js';

interface StoredChallenge {
  nonce: string;
  expiresAt: Date;
  userId: string;
}

/**
 * Single-use ton_proof nonces. In-process is enough for one API instance; a
 * horizontally scaled deployment should move this to Redis behind the same API.
 */
export class WalletChallengeStore {
  private readonly challenges = new Map<string, StoredChallenge>();

  issue(userId: string, now: Date): { id: string; nonce: string; expiresAt: Date } {
    const challenge = createProofChallenge(now);
    const id = randomUUID();
    this.challenges.set(id, { nonce: challenge.nonce, expiresAt: challenge.expiresAt, userId });
    return { id, nonce: challenge.nonce, expiresAt: challenge.expiresAt };
  }

  consume(id: string, userId: string, now: Date): string | undefined {
    const stored = this.challenges.get(id);
    if (!stored) return undefined;
    this.challenges.delete(id);
    if (stored.userId !== userId || stored.expiresAt <= now) return undefined;
    return stored.nonce;
  }
}

export const walletChallenges = new WalletChallengeStore();

export interface LinkWalletInput {
  userId: string;
  challengeId?: string;
  proof?: TonProof;
  /** Only honoured in APP_MODE=mock, where TON Connect is not available. */
  address?: string;
}

function allowedDomains(ctx: AppContext): string[] {
  return [ctx.env.MINI_APP_URL, ctx.env.API_URL]
    .map((url) => {
      try {
        return new URL(url).host;
      } catch {
        return undefined;
      }
    })
    .filter((host): host is string => Boolean(host));
}

export async function linkWallet(ctx: AppContext, input: LinkWalletInput): Promise<Wallet> {
  let addressRaw: string;
  let addressFriendly: string;

  if (input.proof && input.challengeId) {
    const nonce = walletChallenges.consume(input.challengeId, input.userId, ctx.now());
    if (!nonce) throw unauthorized('the wallet challenge is unknown or expired');
    try {
      const verified = verifyTonProof({
        proof: input.proof,
        expectedNonce: nonce,
        allowedDomains: allowedDomains(ctx),
        now: ctx.now(),
      });
      addressRaw = verified.address.raw;
      addressFriendly = verified.address.friendly;
    } catch (error) {
      throw error instanceof TonProofError ? unauthorized(error.message) : error;
    }
  } else if (input.address && ctx.env.APP_MODE === 'mock') {
    try {
      const parsed = parseTonAddress(input.address);
      addressRaw = parsed.raw;
      addressFriendly = parsed.friendly;
    } catch (error) {
      throw error instanceof TonAddressError ? badRequest(error.message) : error;
    }
  } else {
    throw badRequest('a signed ton_proof is required to link a wallet');
  }

  const network = ctx.env.TON_NETWORK === 'mainnet' ? 'MAINNET' : 'TESTNET';
  const existing = await ctx.prisma.wallet.findFirst({ where: { userId: input.userId, addressRaw, network } });
  if (existing) {
    return ctx.prisma.wallet.update({ where: { id: existing.id }, data: { verifiedAt: ctx.now(), isPrimary: true } });
  }

  const wallet = await ctx.prisma.$transaction(async (tx) => {
    await tx.wallet.updateMany({ where: { userId: input.userId }, data: { isPrimary: false } });
    return tx.wallet.create({
      data: {
        ownerType: 'USER',
        userId: input.userId,
        addressRaw,
        addressFriendly,
        network,
        isPrimary: true,
        verifiedAt: ctx.now(),
      },
    });
  });

  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: input.userId,
    action: 'wallet.linked',
    entityType: 'Wallet',
    entityId: wallet.id,
    after: { addressFriendly, network },
  });
  await raiseSharedWalletSignal(ctx, addressRaw, input.userId);
  return wallet;
}

/**
 * One person legitimately uses one wallet across many communities. Many
 * different people behind one wallet is the signal worth recording, and it is
 * only visible because fraud detection sees the whole platform.
 */
async function raiseSharedWalletSignal(ctx: AppContext, addressRaw: string, userId: string): Promise<void> {
  const holders = await ctx.prisma.wallet.findMany({ where: { addressRaw, ownerType: 'USER' }, select: { userId: true } });
  const distinct = new Set(holders.map((wallet) => wallet.userId).filter((id): id is string => Boolean(id)));
  if (distinct.size < 3) return;
  await ctx.prisma.fraudSignal.create({
    data: {
      userId,
      type: 'shared_wallet',
      score: Math.min(100, distinct.size * 10),
      evidence: { addressRaw, distinctUsers: distinct.size } as never,
    },
  });
}

export async function listWallets(ctx: AppContext, userId: string): Promise<Wallet[]> {
  return ctx.prisma.wallet.findMany({ where: { userId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }] });
}

export async function primaryWallet(ctx: AppContext, userId: string): Promise<Wallet | null> {
  return ctx.prisma.wallet.findFirst({ where: { userId, isPrimary: true, verifiedAt: { not: null } } });
}

export async function linkOrganizationWallet(ctx: AppContext, organizationId: string, address: string): Promise<Wallet> {
  let parsed;
  try {
    parsed = parseTonAddress(address);
  } catch (error) {
    throw error instanceof TonAddressError ? badRequest(error.message) : error;
  }
  const network = ctx.env.TON_NETWORK === 'mainnet' ? 'MAINNET' : 'TESTNET';
  if (network === 'MAINNET' && parsed.testOnly) throw unprocessable('that is a testnet address');
  const existing = await ctx.prisma.wallet.findFirst({ where: { organizationId, addressRaw: parsed.raw, network } });
  if (existing) return existing;
  await ctx.prisma.wallet.updateMany({ where: { organizationId }, data: { isPrimary: false } });
  return ctx.prisma.wallet.create({
    data: {
      ownerType: 'ORGANIZATION',
      organizationId,
      addressRaw: parsed.raw,
      addressFriendly: parsed.friendly,
      network,
      isPrimary: true,
      verifiedAt: ctx.now(),
    },
  });
}
