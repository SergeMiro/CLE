import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
import { Cell } from '@ton/core';
import { type TonAddress, parseTonAddress } from './address.js';

export class TonProofError extends Error {}

export interface TonProofChallenge {
  /** Random value the client must sign; single use, short lived. */
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface TonProof {
  timestamp: number;
  domain: { lengthBytes: number; value: string };
  signature: string;
  payload: string;
  /** Wallet's raw ed25519 public key, hex, 32 bytes. */
  publicKeyHex: string;
  address: string;
  /**
   * The wallet's state init, base64, exactly as TON Connect returns it beside
   * the address. It is what ties the signature to the address: without it a
   * signature proves only that someone owns *a* key, not that the key owns the
   * account the rewards would be paid to.
   */
  walletStateInit: string;
}

export interface VerifyTonProofOptions {
  proof: TonProof;
  expectedNonce: string;
  allowedDomains: readonly string[];
  now?: Date;
  maxAgeSeconds?: number;
}

export function createProofChallenge(now = new Date(), ttlSeconds = 600): TonProofChallenge {
  return {
    nonce: randomBytes(32).toString('hex'),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
  };
}

/** SPKI wrapper so node:crypto accepts a bare 32-byte ed25519 key. */
function ed25519PublicKey(publicKeyHex: string) {
  const key = Buffer.from(publicKeyHex, 'hex');
  if (key.length !== 32) throw new TonProofError('an ed25519 public key must be 32 bytes');
  return createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]),
    format: 'der',
    type: 'spki',
  });
}

/** The TON Connect ton_proof message, byte for byte as the wallet builds it. */
export function buildProofMessage(address: TonAddress, proof: Pick<TonProof, 'domain' | 'timestamp' | 'payload'>): Buffer {
  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(address.workchain);
  const domain = Buffer.from(proof.domain.value, 'utf8');
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(domain.length);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64LE(BigInt(proof.timestamp));
  return Buffer.concat([
    Buffer.from('ton-proof-item-v2/', 'utf8'),
    workchain,
    Buffer.from(address.hash, 'hex'),
    domainLength,
    domain,
    timestamp,
    Buffer.from(proof.payload, 'utf8'),
  ]);
}

export function buildSignedDigest(message: Buffer): Buffer {
  const inner = createHash('sha256').update(message).digest();
  const full = Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from('ton-connect', 'utf8'), inner]);
  return createHash('sha256').update(full).digest();
}

export interface VerifiedTonProof {
  address: TonAddress;
  publicKeyHex: string;
  verifiedAt: Date;
}

/**
 * Proves that whoever sent this request controls the wallet's private key,
 * signed our single-use nonce, for our domain, recently.
 */
export function verifyTonProof(options: VerifyTonProofOptions): VerifiedTonProof {
  const { proof, expectedNonce, allowedDomains } = options;
  const now = options.now ?? new Date();
  const maxAgeSeconds = options.maxAgeSeconds ?? 900;

  if (proof.payload !== expectedNonce) throw new TonProofError('ton_proof payload does not match the issued nonce');
  if (!allowedDomains.includes(proof.domain.value)) throw new TonProofError(`domain ${proof.domain.value} is not allowed`);
  if (proof.domain.lengthBytes !== Buffer.byteLength(proof.domain.value, 'utf8')) {
    throw new TonProofError('ton_proof domain length does not match the domain');
  }

  const ageSeconds = Math.floor(now.getTime() / 1000) - proof.timestamp;
  if (ageSeconds > maxAgeSeconds) throw new TonProofError('ton_proof is expired');
  if (ageSeconds < -60) throw new TonProofError('ton_proof is dated in the future');

  const address = parseTonAddress(proof.address);
  const digest = buildSignedDigest(buildProofMessage(address, proof));
  const signature = Buffer.from(proof.signature, 'base64');
  if (signature.length !== 64) throw new TonProofError('ton_proof signature must be 64 bytes');
  if (!verifySignature(null, digest, ed25519PublicKey(proof.publicKeyHex), signature)) {
    throw new TonProofError('ton_proof signature is invalid');
  }
  assertKeyOwnsAddress(proof, address);
  return { address, publicKeyHex: proof.publicKeyHex, verifiedAt: now };
}

/**
 * A signature on its own says nothing about the address it was sent with: a
 * throw-away key can sign our nonce and name any account in the world. The
 * state init closes that gap. An account's address *is* the hash of its state
 * init, so hashing what the wallet sent and comparing it to the claimed
 * address proves the two belong together; finding the signing key inside that
 * state init proves the key is the one that account answers to.
 */
function assertKeyOwnsAddress(proof: TonProof, address: TonAddress): void {
  if (!proof.walletStateInit) throw new TonProofError('ton_proof must carry the wallet state init');
  let stateInit: Cell;
  try {
    stateInit = Cell.fromBase64(proof.walletStateInit);
  } catch {
    throw new TonProofError('the wallet state init is not a valid cell');
  }
  if (stateInit.hash().toString('hex') !== address.hash) {
    throw new TonProofError('the ton_proof address is not the account this state init describes');
  }
  if (!carriesKey(stateInit, bitsOfKey(proof.publicKeyHex))) {
    throw new TonProofError('the ton_proof address does not belong to the key that signed it');
  }
}

function bitsOfKey(publicKeyHex: string): number[] {
  const key = Buffer.from(publicKeyHex, 'hex');
  const bits: number[] = [];
  for (const byte of key) for (let bit = 7; bit >= 0; bit -= 1) bits.push((byte >> bit) & 1);
  return bits;
}

/**
 * Looks for the key anywhere in the wallet's data, bit by bit rather than byte
 * by byte: every wallet stores the public key, but not every wallet stores it
 * on a byte boundary — W5 puts a flag bit in front of it.
 */
function carriesKey(cell: Cell, key: number[], depth = 0): boolean {
  if (depth > 16) return false;
  const bits: number[] = [];
  for (let index = 0; index < cell.bits.length; index += 1) bits.push(cell.bits.at(index) ? 1 : 0);
  for (let offset = 0; offset + key.length <= bits.length; offset += 1) {
    let matched = true;
    for (let index = 0; index < key.length && matched; index += 1) matched = bits[offset + index] === key[index];
    if (matched) return true;
  }
  return cell.refs.some((ref) => carriesKey(ref, key, depth + 1));
}
