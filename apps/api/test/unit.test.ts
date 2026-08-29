import { describe, expect, it } from 'vitest';
import { hashIp } from '../src/services/audit.js';
import { HttpError, badRequest, forbidden, notFound } from '../src/errors.js';
import { hashToken, newReferralCode } from '../src/services/identity.js';
import { normaliseChannelReference } from '../src/services/channels.js';
import { deriveSlug, normaliseSlug } from '../src/services/organizations.js';
import { ROLE_CAPABILITIES } from '../src/services/rbac.js';
import { serialize } from '../src/serialization.js';
import { announcementFor } from '../src/services/quizzes.js';

describe('serialize', () => {
  it('renders bigint money as a string so no precision is lost in JSON', () => {
    expect(serialize({ amountNanoton: 85_500_000_000n })).toEqual({ amountNanoton: '85500000000' });
  });

  it('renders dates as ISO strings and walks nested structures', () => {
    const output = serialize({
      when: new Date('2026-09-01T12:00:00.000Z'),
      rows: [{ value: 1n }, { value: 2n }],
      nested: { deep: { value: 3n } },
    }) as Record<string, unknown>;
    expect(output.when).toBe('2026-09-01T12:00:00.000Z');
    expect(output.rows).toEqual([{ value: '1' }, { value: '2' }]);
    expect(output.nested).toEqual({ deep: { value: '3' } });
  });

  it('leaves other values alone', () => {
    expect(serialize({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null });
  });
});

describe('normaliseSlug', () => {
  it('turns a typed slug into a canonical one', () => {
    expect(normaliseSlug('Science Media Ltd')).toBe('science-media-ltd');
    expect(normaliseSlug('@Science_Daily')).toBe('science-daily');
  });

  it('rejects a slug that is too short or empty after cleaning', () => {
    expect(() => normaliseSlug('ab')).toThrow(HttpError);
    expect(() => normaliseSlug('!!!')).toThrow(/lowercase letters/);
  });

  it('truncates an over-long slug', () => {
    expect(normaliseSlug('a'.repeat(80)).length).toBeLessThanOrEqual(40);
  });
});

describe('deriveSlug', () => {
  it('derives a readable slug from a Latin name', () => {
    expect(deriveSlug('Science Media Ltd')).toBe('science-media-ltd');
  });

  it('generates an identifier when the name leaves no Latin characters', () => {
    // A Cyrillic or Arabic channel name must not block a creator from signing up.
    for (const name of ['Космос и наука', 'العلوم اليومية', '科学日报']) {
      const slug = deriveSlug(name, 'community');
      expect(slug).toMatch(/^community-[0-9a-f]{8}$/);
    }
  });

  it('never returns the same generated slug twice', () => {
    const slugs = new Set(Array.from({ length: 50 }, () => deriveSlug('Наука')));
    expect(slugs.size).toBe(50);
  });
});

describe('normaliseChannelReference', () => {
  it('accepts every shape a creator might paste', () => {
    expect(normaliseChannelReference('@science_daily')).toBe('@science_daily');
    expect(normaliseChannelReference('science_daily')).toBe('@science_daily');
    expect(normaliseChannelReference('https://t.me/science_daily')).toBe('@science_daily');
    expect(normaliseChannelReference('https://t.me/science_daily/42')).toBe('@science_daily');
    expect(normaliseChannelReference('-1001234567890')).toBe(-1001234567890);
  });

  it('rejects something that is not a channel', () => {
    expect(() => normaliseChannelReference('https://example.com/x')).toThrow(HttpError);
    expect(() => normaliseChannelReference('a b c')).toThrow(/Telegram channel/);
  });
});

describe('referral codes', () => {
  it('avoids the deep-link separator and lookalike characters', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = newReferralCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
      expect(code).not.toContain('_');
    }
  });

  it('generates distinct codes', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newReferralCode()));
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('hashing', () => {
  it('hashes a session token to a stable digest', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    expect(hashToken('abc')).toHaveLength(64);
  });

  it('salts an IP address and never stores it in the clear', () => {
    const hashed = hashIp('203.0.113.7', 'salt');
    expect(hashed).not.toContain('203');
    expect(hashed).toHaveLength(32);
    expect(hashIp('203.0.113.7', 'other-salt')).not.toBe(hashed);
    expect(hashIp(undefined, 'salt')).toBeUndefined();
  });
});

describe('role capabilities', () => {
  it('lets only owners and finance move money', () => {
    expect(ROLE_CAPABILITIES['withdrawal:request']).toEqual(['OWNER', 'FINANCE']);
    expect(ROLE_CAPABILITIES['revenue:manage']).toContain('FINANCE');
    expect(ROLE_CAPABILITIES['revenue:manage']).not.toContain('EDITOR');
  });

  it('keeps an analyst read-only', () => {
    const analystCapabilities = Object.entries(ROLE_CAPABILITIES)
      .filter(([, roles]) => roles.includes('ANALYST'))
      .map(([capability]) => capability);
    expect(analystCapabilities).toEqual(['analytics:read']);
  });

  it('gives an owner every capability', () => {
    for (const roles of Object.values(ROLE_CAPABILITIES)) expect(roles).toContain('OWNER');
  });
});

describe('http errors', () => {
  it('carries the status and code the API contract promises', () => {
    expect(badRequest('nope')).toMatchObject({ statusCode: 400, code: 'bad_request' });
    expect(forbidden()).toMatchObject({ statusCode: 403, code: 'forbidden' });
    expect(notFound()).toMatchObject({ statusCode: 404, code: 'not_found' });
  });
});

describe('quiz announcement', () => {
  it('speaks the language of the quiz', () => {
    expect(announcementFor('ru').headline).toBe('ПРОВЕРЬ СЕБЯ');
    expect(announcementFor('en').headline).toBe('TEST YOUR KNOWLEDGE');
    expect(announcementFor('uk').headline).toBe('ПЕРЕВІР СЕБЕ');
  });

  it('falls back to English for a language it does not know', () => {
    expect(announcementFor('pt-BR').headline).toBe('TEST YOUR KNOWLEDGE');
    expect(announcementFor('').headline).toBe('TEST YOUR KNOWLEDGE');
  });

  it('accepts a regional tag', () => {
    expect(announcementFor('RU-ru').headline).toBe('ПРОВЕРЬ СЕБЯ');
  });

  it('counts questions the way each language does', () => {
    expect(announcementFor('ru').questions(1)).toContain('1 вопрос ');
    expect(announcementFor('ru').questions(3)).toContain('3 вопроса');
    expect(announcementFor('ru').questions(7)).toContain('7 вопросов');
    expect(announcementFor('en').questions(1)).toContain('1 question ');
    expect(announcementFor('en').questions(3)).toContain('3 questions');
  });
});

describe('ensureTelegramUser', () => {
  it('is exported for callers that hold only an id', async () => {
    // The behaviour itself is covered by the integration suite against a real
    // database; this guards the seam operator scripts depend on.
    const identity = await import('../src/services/identity.js');
    expect(typeof identity.ensureTelegramUser).toBe('function');
    expect(typeof identity.upsertTelegramUser).toBe('function');
  });
});
