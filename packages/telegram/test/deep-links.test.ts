import { describe, expect, it } from 'vitest';
import { DeepLinkError, decodeStartPayload, encodeStartPayload, miniAppLink } from '../src/index.js';

const communityId = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const quizId = 'aabbccdd-1122-4333-8444-555566667777';

describe('start payloads', () => {
  it('round-trips a community payload', () => {
    const encoded = encodeStartPayload({ kind: 'community', communityId });
    expect(encoded).toMatch(/^c_[0-9a-f]{32}$/);
    expect(decodeStartPayload(encoded)).toEqual({ kind: 'community', communityId });
  });

  it('round-trips a quiz payload', () => {
    expect(decodeStartPayload(encodeStartPayload({ kind: 'quiz', quizId }))).toEqual({ kind: 'quiz', quizId });
  });

  it('round-trips a referral payload with and without a community', () => {
    expect(decodeStartPayload(encodeStartPayload({ kind: 'referral', referralCode: 'AbC-123x' }))).toEqual({
      kind: 'referral',
      referralCode: 'AbC-123x',
    });
    expect(decodeStartPayload(encodeStartPayload({ kind: 'referral', referralCode: 'code1', communityId }))).toEqual({
      kind: 'referral',
      referralCode: 'code1',
      communityId,
    });
  });

  it('stays inside the 64-character Telegram limit', () => {
    expect(encodeStartPayload({ kind: 'referral', referralCode: 'a'.repeat(24), communityId }).length).toBeLessThanOrEqual(64);
  });

  it('rejects identifiers that are not UUIDs', () => {
    expect(() => encodeStartPayload({ kind: 'quiz', quizId: 'not-a-uuid' })).toThrow(DeepLinkError);
  });

  it('rejects a referral code with unsupported characters', () => {
    expect(() => encodeStartPayload({ kind: 'referral', referralCode: 'bad code!' })).toThrow(DeepLinkError);
    // '_' is the field separator, so it must never reach a code.
    expect(() => encodeStartPayload({ kind: 'referral', referralCode: 'has_underscore' })).toThrow(DeepLinkError);
  });

  it('returns undefined for malformed or hostile payloads', () => {
    for (const raw of ['', 'x_123', 'c_zzz', 'q_' + 'f'.repeat(31), 'a'.repeat(70), 'c_<script>']) {
      expect(decodeStartPayload(raw)).toBeUndefined();
    }
  });
});

describe('miniAppLink', () => {
  it('builds a direct Mini App link with a start parameter', () => {
    expect(miniAppLink({ botUsername: '@cle_bot', appName: 'cle', payload: { kind: 'quiz', quizId } })).toBe(
      `https://t.me/cle_bot/cle?startapp=q_${quizId.replace(/-/g, '')}`,
    );
  });

  it('falls back to a bot start link when no app short name exists', () => {
    expect(miniAppLink({ botUsername: 'cle_bot', payload: { kind: 'community', communityId } })).toContain('?start=c_');
  });

  it('builds a plain link with no payload', () => {
    expect(miniAppLink({ botUsername: 'cle_bot' })).toBe('https://t.me/cle_bot');
  });
});
