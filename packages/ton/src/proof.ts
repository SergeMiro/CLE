import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
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
  return { address, publicKeyHex: proof.publicKeyHex, verifiedAt: now };
}
