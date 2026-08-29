import { assertNonNegative } from '@cle/core';
import { type TonNetwork, assertAddressMatchesNetwork, parseTonAddress } from './address.js';

export class TonPayoutError extends Error {}

export interface PayoutRequest {
  /** Reused on retry so a repeated send can never pay twice. */
  idempotencyKey: string;
  toAddress: string;
  amountNanoton: bigint;
  comment?: string;
}

export interface PayoutResult {
  idempotencyKey: string;
  txHash: string;
  status: 'SUBMITTED' | 'CONFIRMED';
  submittedAt: Date;
}

export interface TonPayoutProvider {
  readonly name: string;
  readonly network: TonNetwork;
  send(request: PayoutRequest): Promise<PayoutResult>;
  getStatus(txHash: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED'>;
}

function validate(request: PayoutRequest, network: TonNetwork): void {
  if (!request.idempotencyKey.trim()) throw new TonPayoutError('a payout needs an idempotency key');
  assertNonNegative(request.amountNanoton, 'amountNanoton');
  if (request.amountNanoton === 0n) throw new TonPayoutError('a payout of zero is not allowed');
  assertAddressMatchesNetwork(parseTonAddress(request.toAddress), network);
}

/** Deterministic in-memory payouts for APP_MODE=mock; the same key always returns the same result. */
export class MockTonPayoutProvider implements TonPayoutProvider {
  readonly name = 'mock';
  private readonly sent = new Map<string, PayoutResult>();
  private readonly failures = new Set<string>();

  constructor(readonly network: TonNetwork = 'testnet') {}

  /** Lets a test or a demo force a specific payout to fail. */
  failNext(idempotencyKey: string): void {
    this.failures.add(idempotencyKey);
  }

  get history(): PayoutResult[] {
    return [...this.sent.values()];
  }

  async send(request: PayoutRequest): Promise<PayoutResult> {
    validate(request, this.network);
    const existing = this.sent.get(request.idempotencyKey);
    if (existing) return existing;
    if (this.failures.has(request.idempotencyKey)) {
      this.failures.delete(request.idempotencyKey);
      throw new TonPayoutError(`mock payout ${request.idempotencyKey} rejected`);
    }
    const result: PayoutResult = {
      idempotencyKey: request.idempotencyKey,
      txHash: `mock-${Buffer.from(request.idempotencyKey).toString('hex').slice(0, 48)}`,
      status: 'CONFIRMED',
      submittedAt: new Date(),
    };
    this.sent.set(request.idempotencyKey, result);
    return result;
  }

  async getStatus(txHash: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED'> {
    return [...this.sent.values()].some((result) => result.txHash === txHash) ? 'CONFIRMED' : 'FAILED';
  }
}

export interface HttpTonPayoutOptions {
  network: TonNetwork;
  rpcUrl: string;
  apiKey?: string;
  treasuryAddress: string;
  /** Signs and submits the transfer; supplied by the deployment, never stored in this package. */
  submit: (request: PayoutRequest) => Promise<{ txHash: string }>;
  getStatus?: (txHash: string) => Promise<'PENDING' | 'CONFIRMED' | 'FAILED'>;
}

/**
 * Real payouts. Signing lives behind `submit` so the treasury key never enters
 * CLE's domain code, and the blockchain layer stays swappable for a future
 * smart-contract custody model.
 */
export class HttpTonPayoutProvider implements TonPayoutProvider {
  readonly name = 'ton-http';

  constructor(private readonly options: HttpTonPayoutOptions) {
    if (!options.rpcUrl) throw new TonPayoutError('a TON RPC url is required');
    parseTonAddress(options.treasuryAddress);
  }

  get network(): TonNetwork {
    return this.options.network;
  }

  async send(request: PayoutRequest): Promise<PayoutResult> {
    validate(request, this.network);
    const { txHash } = await this.options.submit(request);
    return { idempotencyKey: request.idempotencyKey, txHash, status: 'SUBMITTED', submittedAt: new Date() };
  }

  async getStatus(txHash: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED'> {
    return this.options.getStatus ? this.options.getStatus(txHash) : 'PENDING';
  }
}
