export class TonAddressError extends Error {}

export type TonNetwork = 'mainnet' | 'testnet';

export interface TonAddress {
  workchain: number;
  /** 32-byte account id, lower-case hex. */
  hash: string;
  bounceable: boolean;
  testOnly: boolean;
  /** "0:abcd..." — the canonical raw form stored in the database. */
  raw: string;
  /** 48-character base64url form shown to people and used by wallets. */
  friendly: string;
}

const BOUNCEABLE_TAG = 0x11;
const NON_BOUNCEABLE_TAG = 0x51;
const TEST_FLAG = 0x80;

/** CRC-16/XMODEM, the checksum TON uses for user-friendly addresses. */
export function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function encodeFriendly(workchain: number, hash: Buffer, bounceable: boolean, testOnly: boolean): string {
  const buffer = Buffer.alloc(36);
  buffer[0] = (bounceable ? BOUNCEABLE_TAG : NON_BOUNCEABLE_TAG) | (testOnly ? TEST_FLAG : 0);
  buffer[1] = workchain & 0xff;
  hash.copy(buffer, 2);
  const checksum = crc16(buffer.subarray(0, 34));
  buffer.writeUInt16BE(checksum, 34);
  return buffer.toString('base64url');
}

function fromParts(workchain: number, hash: Buffer, bounceable: boolean, testOnly: boolean): TonAddress {
  return {
    workchain,
    hash: hash.toString('hex'),
    bounceable,
    testOnly,
    raw: `${workchain}:${hash.toString('hex')}`,
    friendly: encodeFriendly(workchain, hash, bounceable, testOnly),
  };
}

function parseRaw(input: string): TonAddress {
  const match = /^(-?\d+):([0-9a-fA-F]{64})$/.exec(input);
  if (!match) throw new TonAddressError('raw address must look like "0:<64 hex characters>"');
  const workchain = Number(match[1]);
  if (workchain !== 0 && workchain !== -1) throw new TonAddressError(`unsupported workchain ${workchain}`);
  return fromParts(workchain, Buffer.from(match[2] ?? '', 'hex'), true, false);
}

function parseFriendly(input: string): TonAddress {
  if (!/^[A-Za-z0-9_+/=-]{48}$/.test(input)) throw new TonAddressError('a user-friendly address is 48 base64 characters');
  const buffer = Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buffer.length !== 36) throw new TonAddressError('address does not decode to 36 bytes');
  const expected = crc16(buffer.subarray(0, 34));
  if (buffer.readUInt16BE(34) !== expected) throw new TonAddressError('address checksum does not match');
  const tag = buffer[0] ?? 0;
  const testOnly = (tag & TEST_FLAG) !== 0;
  const base = tag & ~TEST_FLAG;
  if (base !== BOUNCEABLE_TAG && base !== NON_BOUNCEABLE_TAG) throw new TonAddressError('unknown address tag');
  const workchainByte = buffer[1] ?? 0;
  const workchain = workchainByte === 0xff ? -1 : workchainByte;
  if (workchain !== 0 && workchain !== -1) throw new TonAddressError(`unsupported workchain ${workchain}`);
  return fromParts(workchain, buffer.subarray(2, 34), base === BOUNCEABLE_TAG, testOnly);
}

/** Accepts either form and normalises it; the caller never has to care which the wallet sent. */
export function parseTonAddress(input: string): TonAddress {
  const value = input.trim();
  if (value === '') throw new TonAddressError('address must not be empty');
  return value.includes(':') ? parseRaw(value) : parseFriendly(value);
}

export function isValidTonAddress(input: string): boolean {
  try {
    parseTonAddress(input);
    return true;
  } catch {
    return false;
  }
}

/** A testnet-only address must never be paid on mainnet, and vice versa. */
export function assertAddressMatchesNetwork(address: TonAddress, network: TonNetwork): void {
  if (network === 'mainnet' && address.testOnly) throw new TonAddressError('a test-only address cannot be used on mainnet');
}

export function toFriendly(address: TonAddress, options: { bounceable?: boolean; testOnly?: boolean } = {}): string {
  return encodeFriendly(
    address.workchain,
    Buffer.from(address.hash, 'hex'),
    options.bounceable ?? address.bounceable,
    options.testOnly ?? address.testOnly,
  );
}
