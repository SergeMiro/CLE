import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adForCommunity } from '../../src/services/ads.js';
import { type TestHarness, createHarness } from '../helpers.js';

/**
 * Which sponsored strip a quiz shows is a billing decision, so the rules are
 * pinned here: a creator's own sponsor outranks CLE's, and a campaign outside
 * its dates is not served — and therefore not charged for.
 */
describe('sponsored slot selection', () => {
  let harness: TestHarness;
  let communityId: string;
  let otherCommunityId: string;

  beforeEach(async () => {
    harness = await createHarness();
    const owner = await harness.prisma.user.create({
      data: { telegramId: 900001n, referralCode: 'ADS-OWNER' },
    });
    const organization = await harness.prisma.organization.create({
      data: { name: 'Ads Org', slug: 'ads-org', ownerUserId: owner.id, status: 'ACTIVE' },
    });

    const build = async (suffix: string) => {
      const channel = await harness.prisma.telegramChannel.create({
        data: {
          organizationId: organization.id,
          telegramChatId: BigInt(`-100200300${suffix}`),
          title: `Channel ${suffix}`,
          status: 'ACTIVE',
        },
      });
      const community = await harness.prisma.community.create({
        data: {
          organizationId: organization.id,
          channelId: channel.id,
          slug: `ads-community-${suffix}`,
          name: `Ads Community ${suffix}`,
          status: 'ACTIVE',
        },
      });
      return community.id;
    };
    communityId = await build('1');
    otherCommunityId = await build('2');
  });

  afterEach(async () => {
    await harness.close();
  });

  const createAd = (data: Record<string, unknown>, communityIds: string[] = []) =>
    harness.prisma.advertisement.create({
      data: {
        sponsor: 'Sponsor',
        headline: 'Headline',
        url: 'https://example.com',
        ...data,
        ...(communityIds.length > 0 ? { targets: { create: communityIds.map((id) => ({ communityId: id })) } } : {}),
      } as never,
    });

  it('shows nothing when no campaign is running', async () => {
    await createAd({ scope: 'PLATFORM', status: 'DRAFT' });
    expect(await adForCommunity(harness.ctx, communityId)).toBeUndefined();
  });

  it('serves an active platform campaign in any community', async () => {
    await createAd({ scope: 'PLATFORM', status: 'ACTIVE', sponsor: 'CLE Sponsor' });
    expect((await adForCommunity(harness.ctx, communityId))?.sponsor).toBe('CLE Sponsor');
    expect((await adForCommunity(harness.ctx, otherCommunityId))?.sponsor).toBe('CLE Sponsor');
  });

  it("lets a community's own sponsor displace the platform one", async () => {
    await createAd({ scope: 'PLATFORM', status: 'ACTIVE', sponsor: 'CLE Sponsor' });
    await createAd({ scope: 'COMMUNITY', status: 'ACTIVE', sponsor: 'Channel Sponsor' }, [communityId]);

    // Weighted choice, so assert it across repeats rather than once.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect((await adForCommunity(harness.ctx, communityId))?.sponsor).toBe('Channel Sponsor');
    }
    // The other community is untouched by a campaign it did not sell.
    expect((await adForCommunity(harness.ctx, otherCommunityId))?.sponsor).toBe('CLE Sponsor');
  });

  it('does not serve a campaign outside its dates', async () => {
    await createAd({
      scope: 'PLATFORM',
      status: 'ACTIVE',
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2026-02-01T00:00:00Z'),
    });
    expect(await adForCommunity(harness.ctx, communityId)).toBeUndefined();

    await createAd({
      scope: 'PLATFORM',
      status: 'ACTIVE',
      sponsor: 'In Window',
      startsAt: new Date('2026-08-01T00:00:00Z'),
      endsAt: new Date('2026-12-01T00:00:00Z'),
    });
    expect((await adForCommunity(harness.ctx, communityId))?.sponsor).toBe('In Window');
  });

  it('runs a targeted campaign only where it was aimed', async () => {
    await createAd({ scope: 'PLATFORM', status: 'ACTIVE', sponsor: 'Targeted' }, [communityId]);

    expect((await adForCommunity(harness.ctx, communityId))?.sponsor).toBe('Targeted');
    // The other community was not bought, so it shows nothing rather than this.
    expect(await adForCommunity(harness.ctx, otherCommunityId)).toBeUndefined();
  });

  it('runs a campaign aimed at several communities in each of them', async () => {
    await createAd({ scope: 'PLATFORM', status: 'ACTIVE', sponsor: 'Both' }, [communityId, otherCommunityId]);

    expect((await adForCommunity(harness.ctx, communityId))?.sponsor).toBe('Both');
    expect((await adForCommunity(harness.ctx, otherCommunityId))?.sponsor).toBe('Both');
  });

  it('prefers a targeted campaign over an untargeted one only by scope, not by aim', async () => {
    // Both are eligible here; targeting decides where, scope decides which wins.
    await createAd({ scope: 'PLATFORM', status: 'ACTIVE', sponsor: 'Everywhere' });
    await createAd({ scope: 'COMMUNITY', status: 'ACTIVE', sponsor: 'Aimed' }, [communityId]);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect((await adForCommunity(harness.ctx, communityId))?.sponsor).toBe('Aimed');
    }
    expect((await adForCommunity(harness.ctx, otherCommunityId))?.sponsor).toBe('Everywhere');
  });

  it('carries the creative image through to the member', async () => {
    await createAd({ scope: 'PLATFORM', status: 'ACTIVE', imageUrl: 'https://cdn.example.com/logo.png' });
    expect((await adForCommunity(harness.ctx, communityId))?.imageUrl).toBe('https://cdn.example.com/logo.png');
  });
});
