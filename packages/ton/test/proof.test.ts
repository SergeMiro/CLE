import { generateKeyPairSync, sign as signMessage } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TonProofError,
  buildProofMessage,
  buildSignedDigest,
  createProofChallenge,
  parseTonAddress,
  verifyTonProof,
  type TonProof,
} from '../src/index.js';

const address = parseTonAddress('0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8');
const now = new Date('2026-08-29T12:00:00Z');
const nonce = 'a'.repeat(64);

function signedProof(overrides: Partial<TonProof> = {}): TonProof {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const base: Omit<TonProof, 'signature'> = {
    timestamp: Math.floor(now.getTime() / 1000),
    domain: { value: 'cle.example', lengthBytes: 'cle.example'.length },
    payload: nonce,
    publicKeyHex: raw.toString('hex'),
    address: address.raw,
    ...overrides,
  };
  const digest = buildSignedDigest(buildProofMessage(parseTonAddress(base.address), base));
  return { ...base, signature: signMessage(null, digest, privateKey).toString('base64'), ...overrides };
}

describe('createProofChallenge', () => {
  it('issues a 32-byte single-use nonce with an expiry', () => {
    const challenge = createProofChallenge(now, 600);
    expect(challenge.nonce).toHaveLength(64);
    expect(challenge.expiresAt.getTime() - challenge.issuedAt.getTime()).toBe(600_000);
    expect(createProofChallenge(now).nonce).not.toBe(challenge.nonce);
  });
});

describe('verifyTonProof', () => {
  const options = { expectedNonce: nonce, allowedDomains: ['cle.example'], now };

  it('accepts a correctly signed proof', () => {
    const result = verifyTonProof({ ...options, proof: signedProof() });
    expect(result.address.raw).toBe(address.raw);
  });

  it('rejects a proof for a different nonce', () => {
    expect(() => verifyTonProof({ ...options, proof: signedProof({ payload: 'b'.repeat(64) }) })).toThrow(/nonce/);
  });

  it('rejects a proof for another domain', () => {
    const proof = signedProof({ domain: { value: 'evil.example', lengthBytes: 'evil.example'.length } });
    expect(() => verifyTonProof({ ...options, proof })).toThrow(/not allowed/);
  });

  it('rejects a domain whose declared length is wrong', () => {
    const proof = signedProof({ domain: { value: 'cle.example', lengthBytes: 99 } });
    expect(() => verifyTonProof({ ...options, proof })).toThrow(/domain length/);
  });

  it('rejects an expired proof', () => {
    const proof = signedProof({ timestamp: Math.floor(now.getTime() / 1000) - 4000 });
    expect(() => verifyTonProof({ ...options, proof })).toThrow(/expired/);
  });

  it('rejects a proof dated in the future', () => {
    const proof = signedProof({ timestamp: Math.floor(now.getTime() / 1000) + 3600 });
    expect(() => verifyTonProof({ ...options, proof })).toThrow(/future/);
  });

  it('rejects a tampered signature', () => {
    const proof = signedProof();
    const bytes = Buffer.from(proof.signature, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(() => verifyTonProof({ ...options, proof: { ...proof, signature: bytes.toString('base64') } })).toThrow(/invalid/);
  });

  it('rejects a proof signed for a different wallet address', () => {
    const proof = signedProof();
    expect(() =>
      verifyTonProof({ ...options, proof: { ...proof, address: `0:${'11'.repeat(32)}` } }),
    ).toThrow(TonProofError);
  });

  it('rejects a malformed public key or signature length', () => {
    const proof = signedProof();
    expect(() => verifyTonProof({ ...options, proof: { ...proof, publicKeyHex: 'ab' } })).toThrow(/32 bytes/);
    expect(() => verifyTonProof({ ...options, proof: { ...proof, signature: 'AAAA' } })).toThrow(/64 bytes/);
  });
});
