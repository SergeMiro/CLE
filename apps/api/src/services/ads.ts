import type { Advertisement } from '@cle/db';
import type { AppContext } from '../context.js';

/** What a member's device is allowed to see about a sponsored slot. */
export interface PublicAd {
  id: string;
  sponsor: string;
  headline: string;
  body: string | null;
  ctaLabel: string | null;
  imageUrl: string | null;
  url: string;
}

function toPublic(ad: Advertisement): PublicAd {
  return {
    id: ad.id,
    sponsor: ad.sponsor,
    headline: ad.headline,
    body: ad.body,
    ctaLabel: ad.ctaLabel,
    imageUrl: ad.imageUrl,
    url: ad.url,
  };
}

/**
 * Picks the ad to show beside a quiz.
 *
 * Targeting and priority are separate questions. `targets` decides *where* a
 * campaign may run — no rows means everywhere, which is the ordinary case for a
 * platform campaign and should not need a row per community to express.
 * `scope` decides *who sold it*: a community's own sponsor always wins over a
 * platform-wide one, because a creator who sold their slot must not have it
 * taken by CLE. Within one scope the choice is weighted, so a campaign bought
 * at twice the weight is served twice as often.
 */
export async function adForCommunity(ctx: AppContext, communityId: string): Promise<PublicAd | undefined> {
  const now = ctx.now();
  const eligible = await ctx.prisma.advertisement.findMany({
    where: {
      status: 'ACTIVE',
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        { OR: [{ targets: { none: {} } }, { targets: { some: { communityId } } }] },
      ],
    },
  });
  if (eligible.length === 0) return undefined;

  const own = eligible.filter((ad) => ad.scope === 'COMMUNITY');
  const pool = own.length > 0 ? own : eligible;
  const total = pool.reduce((sum, ad) => sum + Math.max(1, ad.weight), 0);
  let ticket = Math.random() * total;
  for (const ad of pool) {
    ticket -= Math.max(1, ad.weight);
    if (ticket <= 0) return toPublic(ad);
  }
  return toPublic(pool[pool.length - 1]!);
}

/**
 * Counted with a conditional update rather than a read-then-write, so parallel
 * views of the same quiz cannot lose each other's increments.
 */
export async function countAdImpression(ctx: AppContext, adId: string): Promise<void> {
  await ctx.prisma.advertisement.updateMany({ where: { id: adId }, data: { impressions: { increment: 1 } } });
}

export async function countAdClick(ctx: AppContext, adId: string): Promise<void> {
  await ctx.prisma.advertisement.updateMany({ where: { id: adId }, data: { clicks: { increment: 1 } } });
}
