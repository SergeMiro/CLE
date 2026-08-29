import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

describe('financial persistence schema', () => {
  it('uses bigint nanotons and immutable ledger references', () => {
    expect(schema).toContain('amountNanoton BigInt');
    expect(schema).toContain('model LedgerEntry');
    expect(schema).toContain('reference String @unique');
  });

  it('prevents duplicate cycle category allocations and duplicate attempts', () => {
    expect(schema).toContain('@@unique([cycleId, userId, type])');
    expect(schema).toContain('@@unique([quizId, userId])');
    expect(schema).toContain('idempotencyKey String @unique');
  });
});
