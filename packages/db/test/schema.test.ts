import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

/**
 * These assertions guard the properties the money depends on. They are cheap
 * and they fail loudly if a future migration quietly drops one.
 */
describe('persistence schema', () => {
  it('stores every amount as a bigint nanoton value', () => {
    for (const field of [
      'amountNanoton     BigInt',
      'grossNanoton          BigInt',
      'platformFeeNanoton    BigInt',
      'creatorShareNanoton   BigInt',
      'communityShareNanoton BigInt',
      'minWithdrawalNanoton   BigInt',
    ]) {
      expect(schema).toContain(field);
    }
    // No floating point may ever appear in the data model.
    expect(schema).not.toMatch(/\bFloat\b/);
    expect(schema).not.toMatch(/\bDecimal\b/);
  });

  it('keeps a double-entry ledger with unique transaction references', () => {
    expect(schema).toContain('model LedgerAccount');
    expect(schema).toContain('model LedgerTransaction');
    expect(schema).toContain('model LedgerEntry');
    expect(schema).toContain('reference String                @unique');
    expect(schema).toContain('direction     LedgerDirection');
  });

  it('never cascades a delete through financial history', () => {
    const ledgerEntry = schema.slice(schema.indexOf('model LedgerEntry'), schema.indexOf('model BalanceSnapshot'));
    expect(ledgerEntry).toContain('onDelete: Restrict');
    expect(ledgerEntry).not.toContain('onDelete: Cascade');

    const withdrawal = schema.slice(schema.indexOf('model Withdrawal'), schema.indexOf('model Payout'));
    expect(withdrawal).toContain('onDelete: Restrict');
  });

  it('prevents double payment and double answering', () => {
    expect(schema).toContain('@@unique([cycleId, userId, type])');
    expect(schema).toContain('@@unique([quizId, userId])');
    expect(schema).toContain('idempotencyKey String                 @unique');
    expect(schema).toContain('idempotencyKey String            @unique');
  });

  it('scopes every tenant-owned record to an organization or a community', () => {
    for (const model of ['model TelegramChannel', 'model Community', 'model RevenueEntry']) {
      const start = schema.indexOf(model);
      const body = schema.slice(start, start + 1200);
      expect(body).toMatch(/organizationId\s+String/);
    }
    expect(schema).toContain('@@unique([communityId, userId])');
    expect(schema).toContain('@@unique([channelId, telegramMessageId])');
  });

  it('versions every policy instead of overwriting it', () => {
    for (const unique of [
      '@@unique([communityId, version])',
      'model PlatformPolicy',
      'model RevenuePolicy',
      'model RewardPolicy',
      'model QuizGenerationPolicy',
    ]) {
      expect(schema).toContain(unique);
    }
  });

  it('deduplicates inbound Telegram updates', () => {
    expect(schema).toContain('model WebhookEvent');
    expect(schema).toContain('@@unique([provider, externalId])');
  });
});
