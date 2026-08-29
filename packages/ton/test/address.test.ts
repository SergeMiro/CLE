import { describe, expect, it } from 'vitest';
import { TonAddressError, assertAddressMatchesNetwork, crc16, isValidTonAddress, parseTonAddress, toFriendly } from '../src/index.js';

// A well-known TON address (the mainnet foundation wallet) in both forms.
const rawAddress = '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8';

describe('crc16', () => {
  it('matches the XMODEM reference vector', () => {
    expect(crc16(Buffer.from('123456789', 'ascii'))).toBe(0x31c3);
  });
});

describe('parseTonAddress', () => {
  it('parses a raw address and produces a friendly form', () => {
    const address = parseTonAddress(rawAddress);
    expect(address.workchain).toBe(0);
    expect(address.raw).toBe(rawAddress);
    expect(address.friendly).toHaveLength(48);
  });

  it('round-trips raw -> friendly -> raw', () => {
    const address = parseTonAddress(rawAddress);
    expect(parseTonAddress(address.friendly).raw).toBe(rawAddress);
  });

  it('preserves the bounceable and test-only flags', () => {
    const address = parseTonAddress(rawAddress);
    const testFriendly = toFriendly(address, { testOnly: true, bounceable: false });
    const parsed = parseTonAddress(testFriendly);
    expect(parsed.testOnly).toBe(true);
    expect(parsed.bounceable).toBe(false);
    expect(parsed.raw).toBe(rawAddress);
  });

  it('accepts the masterchain workchain', () => {
    expect(parseTonAddress(`-1:${'ab'.repeat(32)}`).workchain).toBe(-1);
  });

  it('rejects a corrupted checksum', () => {
    const friendly = parseTonAddress(rawAddress).friendly;
    const corrupted = `${friendly.slice(0, 20)}${friendly[20] === 'A' ? 'B' : 'A'}${friendly.slice(21)}`;
    expect(() => parseTonAddress(corrupted)).toThrow(/checksum/);
  });

  it('rejects malformed input', () => {
    for (const value of ['', '   ', 'not-an-address', '0:zz', `2:${'ab'.repeat(32)}`]) {
      expect(() => parseTonAddress(value)).toThrow(TonAddressError);
    }
  });

  it('exposes a boolean guard', () => {
    expect(isValidTonAddress(rawAddress)).toBe(true);
    expect(isValidTonAddress('nope')).toBe(false);
  });
});

describe('assertAddressMatchesNetwork', () => {
  it('refuses a test-only address on mainnet', () => {
    const testAddress = parseTonAddress(toFriendly(parseTonAddress(rawAddress), { testOnly: true }));
    expect(() => assertAddressMatchesNetwork(testAddress, 'mainnet')).toThrow(TonAddressError);
    expect(() => assertAddressMatchesNetwork(testAddress, 'testnet')).not.toThrow();
  });
});
