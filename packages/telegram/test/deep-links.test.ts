import { describe, expect, it } from 'vitest';
import { DeepLinkError, botStartLink, decodeStartPayload, encodeStartPayload, miniAppLink } from '../src/index.js';

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
  it('opens a named Mini App published with /newapp', () => {
    expect(miniAppLink({ botUsername: '@cle_bot', appName: 'cle', payload: { kind: 'quiz', quizId } })).toBe(
      `https://t.me/cle_bot/cle?startapp=q_${quizId.replace(/-/g, '')}`,
    );
  });

  it('opens a Main Mini App when no short name is configured', () => {
    // Without startapp the link lands in a chat with the bot instead of the app,
    // which is the dead end this form exists to avoid.
    expect(miniAppLink({ botUsername: 'cle_bot', payload: { kind: 'community', communityId } })).toBe(
      `https://t.me/cle_bot?startapp=c_${communityId.replace(/-/g, '')}`,
    );
  });

  it('still opens the app when there is no payload', () => {
    expect(miniAppLink({ botUsername: 'cle_bot' })).toBe('https://t.me/cle_bot?startapp=');
  });

  it('strips a leading @ from the username', () => {
    expect(miniAppLink({ botUsername: '@cle_bot' })).toBe('https://t.me/cle_bot?startapp=');
  });
});

describe('botStartLink', () => {
  it('opens a conversation with the bot, carrying a start payload', () => {
    expect(botStartLink({ botUsername: 'cle_bot', payload: { kind: 'referral', referralCode: 'ABC123' } })).toBe(
      'https://t.me/cle_bot?start=r_ABC123',
    );
  });

  it('opens a plain conversation with no payload', () => {
    expect(botStartLink({ botUsername: '@cle_bot' })).toBe('https://t.me/cle_bot');
  });
});
