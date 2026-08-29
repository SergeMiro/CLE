import { describe, expect, it, vi } from 'vitest';
import { parseTon } from '@cle/core';
import { HttpTonPayoutProvider, MockTonPayoutProvider, TonPayoutError, parseTonAddress, toFriendly } from '../src/index.js';

const address = '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8';

describe('MockTonPayoutProvider', () => {
  it('sends a payout and confirms it', async () => {
    const provider = new MockTonPayoutProvider();
    const result = await provider.send({ idempotencyKey: 'w-1', toAddress: address, amountNanoton: 1_000_000_000n });
    expect(result.status).toBe('CONFIRMED');
    expect(await provider.getStatus(result.txHash)).toBe('CONFIRMED');
  });

  it('returns the same result for a replayed idempotency key', async () => {
    const provider = new MockTonPayoutProvider();
    const first = await provider.send({ idempotencyKey: 'w-1', toAddress: address, amountNanoton: 5n });
    const second = await provider.send({ idempotencyKey: 'w-1', toAddress: address, amountNanoton: 5n });
    expect(second).toEqual(first);
    expect(provider.history).toHaveLength(1);
  });

  it('can be told to fail a specific payout', async () => {
    const provider = new MockTonPayoutProvider();
    provider.failNext('w-2');
    await expect(provider.send({ idempotencyKey: 'w-2', toAddress: address, amountNanoton: 5n })).rejects.toBeInstanceOf(TonPayoutError);
    await expect(provider.send({ idempotencyKey: 'w-2', toAddress: address, amountNanoton: 5n })).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('rejects an empty key, a zero amount and a bad address', async () => {
    const provider = new MockTonPayoutProvider();
    await expect(provider.send({ idempotencyKey: ' ', toAddress: address, amountNanoton: 1n })).rejects.toThrow(/idempotency/);
    await expect(provider.send({ idempotencyKey: 'k', toAddress: address, amountNanoton: 0n })).rejects.toThrow(/zero/);
    await expect(provider.send({ idempotencyKey: 'k', toAddress: 'nope', amountNanoton: 1n })).rejects.toThrow();
  });

  it('refuses a test-only address on a mainnet provider', async () => {
    const provider = new MockTonPayoutProvider('mainnet');
    const testOnly = toFriendly(parseTonAddress(address), { testOnly: true });
    await expect(provider.send({ idempotencyKey: 'k', toAddress: testOnly, amountNanoton: 1n })).rejects.toThrow(/test-only/);
  });
});

describe('HttpTonPayoutProvider', () => {
  it('delegates signing to the injected submitter', async () => {
    const submit = vi.fn(async () => ({ txHash: 'abc' }));
    const provider = new HttpTonPayoutProvider({
      network: 'testnet',
      rpcUrl: 'https://testnet.toncenter.com/api/v2/jsonRPC',
      treasuryAddress: address,
      submit,
    });
    const result = await provider.send({ idempotencyKey: 'w-9', toAddress: address, amountNanoton: parseTon('1') });
    expect(result).toMatchObject({ txHash: 'abc', status: 'SUBMITTED' });
    expect(submit).toHaveBeenCalledOnce();
  });

  it('requires an rpc url and a valid treasury address', () => {
    expect(() => new HttpTonPayoutProvider({ network: 'testnet', rpcUrl: '', treasuryAddress: address, submit: async () => ({ txHash: '' }) })).toThrow(
      TonPayoutError,
    );
    expect(
      () => new HttpTonPayoutProvider({ network: 'testnet', rpcUrl: 'https://x', treasuryAddress: 'bad', submit: async () => ({ txHash: '' }) }),
    ).toThrow();
  });

  it('reports PENDING when no status probe is configured', async () => {
    const provider = new HttpTonPayoutProvider({
      network: 'testnet',
      rpcUrl: 'https://x',
      treasuryAddress: address,
      submit: async () => ({ txHash: 'abc' }),
    });
    expect(await provider.getStatus('abc')).toBe('PENDING');
  });
});
