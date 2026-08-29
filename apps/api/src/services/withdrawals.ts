import { randomUUID } from 'node:crypto';
import type { Withdrawal } from '@cle/db';
import { type WithdrawalSubject, withdrawalCompleteTransaction, withdrawalLockTransaction, withdrawalReleaseTransaction } from '@cle/ledger';
import { TonPayoutError } from '@cle/ton';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound, unprocessable } from '../errors.js';
import { recordAudit } from './audit.js';
import { organizationBalances, postTransaction, userBalances } from './ledger.js';
import { currentPlatformPolicy } from './policies.js';
import { type Actor, requireOrganizationAccess } from './rbac.js';
import { primaryWallet } from './wallets.js';

export interface RequestWithdrawalInput {
  amountNanoton: bigint;
  walletId?: string;
}

/**
 * A member withdraws their whole CLE balance, not one channel at a time: the
 * rewards from every community land in the same user account.
 */
export async function requestUserWithdrawal(ctx: AppContext, actor: Actor, input: RequestWithdrawalInput): Promise<Withdrawal> {
  if (input.amountNanoton <= 0n) throw badRequest('the amount must be positive');
  const platform = await currentPlatformPolicy(ctx);
  if (input.amountNanoton < platform.minWithdrawalNanoton) {
    throw unprocessable(`the minimum withdrawal is ${platform.minWithdrawalNanoton} nanoton`);
  }

  const wallet = input.walletId
    ? await ctx.prisma.wallet.findFirst({ where: { id: input.walletId, userId: actor.id, verifiedAt: { not: null } } })
    : await primaryWallet(ctx, actor.id);
  if (!wallet) throw unprocessable('link and verify a TON wallet first');

  const pendingCount = await ctx.prisma.withdrawal.count({
    where: { userId: actor.id, status: { in: ['REQUESTED', 'LOCKED', 'PROCESSING', 'SUBMITTED'] } },
  });
  if (pendingCount > 0) throw conflict('a withdrawal is already in progress');

  const withdrawal = await ctx.prisma.$transaction(async (tx) => {
    const balances = await userBalances(tx, actor.id);
    if (balances.available < input.amountNanoton) throw unprocessable('insufficient available balance');
    const created = await tx.withdrawal.create({
      data: {
        subjectType: 'USER',
        userId: actor.id,
        walletId: wallet.id,
        amountNanoton: input.amountNanoton,
        status: 'LOCKED',
        idempotencyKey: randomUUID(),
      },
    });
    await postTransaction(
      tx,
      withdrawalLockTransaction({ withdrawalId: created.id, subject: { type: 'USER', userId: actor.id }, amountNanoton: input.amountNanoton }),
    );
    return created;
  });

  await recordAudit(ctx, {
    actorType: 'USER',
    actorId: actor.id,
    action: 'withdrawal.requested',
    entityType: 'Withdrawal',
    entityId: withdrawal.id,
    after: { amountNanoton: withdrawal.amountNanoton.toString() },
  });
  return withdrawal;
}

export async function requestOrganizationWithdrawal(
  ctx: AppContext,
  actor: Actor,
  organizationId: string,
  input: RequestWithdrawalInput,
): Promise<Withdrawal> {
  await requireOrganizationAccess(ctx, actor, organizationId, 'withdrawal:request');
  if (input.amountNanoton <= 0n) throw badRequest('the amount must be positive');
  const wallet = input.walletId
    ? await ctx.prisma.wallet.findFirst({ where: { id: input.walletId, organizationId } })
    : await ctx.prisma.wallet.findFirst({ where: { organizationId, isPrimary: true } });
  if (!wallet) throw unprocessable('the organization has no payout wallet');

  return ctx.prisma.$transaction(async (tx) => {
    const balances = await organizationBalances(tx, organizationId);
    if (balances.available < input.amountNanoton) throw unprocessable('insufficient creator balance');
    const created = await tx.withdrawal.create({
      data: {
        subjectType: 'ORGANIZATION',
        organizationId,
        walletId: wallet.id,
        amountNanoton: input.amountNanoton,
        status: 'LOCKED',
        idempotencyKey: randomUUID(),
      },
    });
    await postTransaction(
      tx,
      withdrawalLockTransaction({ withdrawalId: created.id, subject: { type: 'ORGANIZATION', organizationId }, amountNanoton: input.amountNanoton }),
    );
    return created;
  });
}

function subjectOf(withdrawal: Withdrawal): WithdrawalSubject {
  return withdrawal.subjectType === 'USER'
    ? { type: 'USER', userId: withdrawal.userId! }
    : { type: 'ORGANIZATION', organizationId: withdrawal.organizationId! };
}

export interface ProcessResult {
  withdrawal: Withdrawal;
  txHash?: string;
  error?: string;
}

/**
 * Sends the locked amount on-chain. The payout provider is keyed by the
 * withdrawal id, so a retry after a timeout cannot pay twice; a failure
 * releases the lock back to the available balance.
 */
export async function processWithdrawal(ctx: AppContext, withdrawalId: string): Promise<ProcessResult> {
  const withdrawal = await ctx.prisma.withdrawal.findUnique({ where: { id: withdrawalId }, include: { wallet: true } });
  if (!withdrawal) throw notFound('withdrawal not found');
  if (withdrawal.status !== 'LOCKED') throw unprocessable(`a withdrawal in status ${withdrawal.status} cannot be processed`);

  await ctx.prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'PROCESSING', processingAt: ctx.now() } });

  try {
    const payout = await ctx.payouts.send({
      idempotencyKey: withdrawal.idempotencyKey,
      toAddress: withdrawal.wallet.addressFriendly,
      amountNanoton: withdrawal.amountNanoton,
      comment: `CLE withdrawal ${withdrawal.id}`,
    });

    const completed = await ctx.prisma.$transaction(async (tx) => {
      await postTransaction(
        tx,
        withdrawalCompleteTransaction({
          withdrawalId: withdrawal.id,
          subject: subjectOf(withdrawal),
          amountNanoton: withdrawal.amountNanoton,
        }),
      );
      await tx.payout.create({
        data: {
          withdrawalId: withdrawal.id,
          provider: ctx.payouts.name,
          network: ctx.env.TON_NETWORK === 'mainnet' ? 'MAINNET' : 'TESTNET',
          txHash: payout.txHash,
          submittedAt: payout.submittedAt,
          confirmedAt: payout.status === 'CONFIRMED' ? ctx.now() : null,
        },
      });
      if (withdrawal.subjectType === 'USER') {
        await tx.rewardAllocation.updateMany({ where: { userId: withdrawal.userId!, status: 'AVAILABLE' }, data: { status: 'PAID' } });
      }
      return tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'CONFIRMED', txHash: payout.txHash, completedAt: ctx.now() },
      });
    });

    await recordAudit(ctx, {
      actorType: 'SYSTEM',
      action: 'withdrawal.completed',
      entityType: 'Withdrawal',
      entityId: withdrawal.id,
      after: { txHash: payout.txHash },
    });
    return { withdrawal: completed, txHash: payout.txHash };
  } catch (error) {
    const message = error instanceof TonPayoutError || error instanceof Error ? error.message : String(error);
    const failed = await ctx.prisma.$transaction(async (tx) => {
      await postTransaction(
        tx,
        withdrawalReleaseTransaction({
          withdrawalId: withdrawal.id,
          subject: subjectOf(withdrawal),
          amountNanoton: withdrawal.amountNanoton,
        }),
      );
      return tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'FAILED', failureReason: message.slice(0, 500), failedAt: ctx.now() },
      });
    });
    await recordAudit(ctx, {
      actorType: 'SYSTEM',
      action: 'withdrawal.failed',
      entityType: 'Withdrawal',
      entityId: withdrawal.id,
      after: { reason: message.slice(0, 200) },
    });
    return { withdrawal: failed, error: message };
  }
}

export async function listUserWithdrawals(ctx: AppContext, userId: string) {
  return ctx.prisma.withdrawal.findMany({
    where: { userId },
    include: { wallet: { select: { addressFriendly: true } } },
    orderBy: { requestedAt: 'desc' },
    take: 50,
  });
}
