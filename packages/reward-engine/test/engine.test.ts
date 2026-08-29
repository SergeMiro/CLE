import { describe, expect, it } from 'vitest';
import { DEFAULT_LOYALTY_TIERS, parseTon } from '@cle/core';
import {
  RewardEngineError,
  allocationIdempotencyKey,
  calculateRewardCycle,
  evaluateMember,
  type MemberInput,
  type RewardPolicyInput,
} from '../src/index.js';

const policy: RewardPolicyInput = {
  growthBps: 3500,
  loyaltyBps: 4000,
  referralBps: 1500,
  learningBps: 1000,
  newMemberHoldDays: 7,
  rejoinCooldownDays: 7,
  loyaltyTiers: DEFAULT_LOYALTY_TIERS,
  minRewardNanoton: 0n,
};

function member(overrides: Partial<MemberInput> & Pick<MemberInput, 'userId'>): MemberInput {
  return {
    memberId: `m-${overrides.userId}`,
    status: 'ACTIVE',
    eligibility: 'ELIGIBLE',
    membershipAgeDays: 60,
    rejoinCount: 0,
    referralUnits: 0,
    learningPoints: 0,
    ...overrides,
  };
}

describe('evaluateMember', () => {
  it('holds a member who is younger than the new-member hold', () => {
    const result = evaluateMember(member({ userId: 'u1', membershipAgeDays: 3 }), policy);
    expect(result.growthEligible).toBe(false);
    expect(result.loyaltyWeightBps).toBe(0);
  });

  it('admits a member once the hold has passed', () => {
    const result = evaluateMember(member({ userId: 'u1', membershipAgeDays: 7 }), policy);
    expect(result.growthEligible).toBe(true);
    expect(result.loyaltyWeightBps).toBe(10_000);
  });

  it('excludes a member who has left', () => {
    const result = evaluateMember(member({ userId: 'u1', status: 'LEFT', learningPoints: 50 }), policy);
    expect(result.growthEligible).toBe(false);
    expect(result.learningPoints).toBe(0);
  });

  it('excludes a blocked member even while active', () => {
    const result = evaluateMember(member({ userId: 'u1', eligibility: 'BLOCKED', referralUnits: 4 }), policy);
    expect(result.growthEligible).toBe(false);
    expect(result.referralUnits).toBe(0);
  });

  it('keeps a rejoined member in cooldown out of the pools', () => {
    const result = evaluateMember(member({ userId: 'u1', status: 'REJOIN_COOLDOWN', rejoinCount: 1, membershipAgeDays: 2 }), policy);
    expect(result.growthEligible).toBe(false);
  });

  it('lets a rejoined member back in after the cooldown', () => {
    const result = evaluateMember(member({ userId: 'u1', rejoinCount: 1, membershipAgeDays: 30 }), policy);
    expect(result.growthEligible).toBe(true);
  });

  it('still pays learning and referral rewards during the new-member hold', () => {
    const result = evaluateMember(member({ userId: 'u1', membershipAgeDays: 1, learningPoints: 30, referralUnits: 2 }), policy);
    expect(result.growthEligible).toBe(false);
    expect(result.learningPoints).toBe(30);
    expect(result.referralUnits).toBe(2);
  });

  it('rejects malformed input', () => {
    expect(() => evaluateMember(member({ userId: 'u1', membershipAgeDays: -1 }), policy)).toThrow(RewardEngineError);
    expect(() => evaluateMember(member({ userId: 'u1', learningPoints: -5 }), policy)).toThrow(RewardEngineError);
  });
});

describe('calculateRewardCycle', () => {
  it('splits a community share across the four pools', () => {
    const result = calculateRewardCycle({
      distributableNanoton: parseTon('85.5'),
      policy,
      members: [
        member({ userId: 'a', membershipAgeDays: 400, learningPoints: 30, referralUnits: 1 }),
        member({ userId: 'b', membershipAgeDays: 10, learningPoints: 10 }),
      ],
    });

    const byType = Object.fromEntries(result.pools.map((pool) => [pool.type, pool]));
    expect(byType.GROWTH?.amountNanoton).toBe(parseTon('29.925'));
    expect(byType.LOYALTY?.amountNanoton).toBe(parseTon('34.2'));
    expect(byType.REFERRAL?.amountNanoton).toBe(parseTon('12.825'));
    expect(byType.LEARNING?.amountNanoton).toBe(parseTon('8.55'));
    expect(result.totalAllocatedNanoton + result.totalCarriedNanoton).toBe(parseTon('85.5'));
  });

  it('splits the growth pool equally between eligible members', () => {
    const result = calculateRewardCycle({
      distributableNanoton: parseTon('100'),
      policy: { ...policy, growthBps: 10_000, loyaltyBps: 0, referralBps: 0, learningBps: 0 },
      members: [member({ userId: 'a' }), member({ userId: 'b' }), member({ userId: 'c', membershipAgeDays: 1 })],
    });
    const growth = result.allocations.filter((allocation) => allocation.type === 'GROWTH');
    expect(growth).toHaveLength(2);
    expect(growth.every((allocation) => allocation.amountNanoton === parseTon('50'))).toBe(true);
  });

  it('weights the loyalty pool by membership tier', () => {
    const result = calculateRewardCycle({
      distributableNanoton: parseTon('30'),
      policy: { ...policy, growthBps: 0, loyaltyBps: 10_000, referralBps: 0, learningBps: 0 },
      members: [member({ userId: 'a', membershipAgeDays: 10 }), member({ userId: 'b', membershipAgeDays: 400 })],
    });
    const [first, second] = result.allocations;
    expect(first?.userId).toBe('a');
    expect(first?.amountNanoton).toBe(parseTon('10'));
    expect(second?.amountNanoton).toBe(parseTon('20'));
  });

  it('weights the learning pool by points earned in the cycle', () => {
    const result = calculateRewardCycle({
      distributableNanoton: parseTon('9'),
      policy: { ...policy, growthBps: 0, loyaltyBps: 0, referralBps: 0, learningBps: 10_000 },
      members: [member({ userId: 'a', learningPoints: 10 }), member({ userId: 'b', learningPoints: 20 })],
    });
    expect(result.allocations.map((allocation) => allocation.amountNanoton)).toEqual([parseTon('3'), parseTon('6')]);
  });

  it('carries a pool that nobody qualified for back to the community', () => {
    const result = calculateRewardCycle({
      distributableNanoton: parseTon('100'),
      policy,
      members: [member({ userId: 'a' })],
    });
    const referral = result.pools.find((pool) => pool.type === 'REFERRAL');
    expect(referral?.distributedNanoton).toBe(0n);
    expect(referral?.carriedNanoton).toBe(referral?.amountNanoton);
    expect(result.allocations.some((allocation) => allocation.type === 'REFERRAL')).toBe(false);
  });

  it('carries everything when no member is eligible', () => {
    const result = calculateRewardCycle({
      distributableNanoton: parseTon('50'),
      policy,
      members: [member({ userId: 'a', status: 'LEFT' })],
    });
    expect(result.totalAllocatedNanoton).toBe(0n);
    expect(result.totalCarriedNanoton).toBe(parseTon('50'));
  });

  it('handles an empty community', () => {
    const result = calculateRewardCycle({ distributableNanoton: parseTon('10'), policy, members: [] });
    expect(result.allocations).toHaveLength(0);
    expect(result.totalCarriedNanoton).toBe(parseTon('10'));
  });

  it('never loses or invents a nanoton, across many shapes of community', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const members = Array.from({ length: (seed % 11) + 1 }, (_, index) =>
        member({
          userId: `u${index}`,
          membershipAgeDays: (seed * 3 + index * 17) % 500,
          learningPoints: (seed + index * 7) % 91,
          referralUnits: (seed + index) % 4,
          status: index % 9 === 0 ? 'LEFT' : 'ACTIVE',
        }),
      );
      const distributable = BigInt(seed * 7919 + 1);
      const result = calculateRewardCycle({ distributableNanoton: distributable, policy, members });
      expect(result.totalAllocatedNanoton + result.totalCarriedNanoton).toBe(distributable);
      for (const pool of result.pools) {
        expect(pool.distributedNanoton + pool.carriedNanoton).toBe(pool.amountNanoton);
      }
    }
  });

  it('is deterministic when the input order changes', () => {
    const members = [
      member({ userId: 'c', learningPoints: 5 }),
      member({ userId: 'a', learningPoints: 11 }),
      member({ userId: 'b', membershipAgeDays: 200 }),
    ];
    const forward = calculateRewardCycle({ distributableNanoton: parseTon('7.77'), policy, members });
    const reversed = calculateRewardCycle({ distributableNanoton: parseTon('7.77'), policy, members: [...members].reverse() });
    expect(forward.allocations).toEqual(reversed.allocations);
  });

  it('drops dust allocations below the policy minimum and carries them', () => {
    const result = calculateRewardCycle({
      distributableNanoton: 1000n,
      policy: { ...policy, growthBps: 10_000, loyaltyBps: 0, referralBps: 0, learningBps: 0, minRewardNanoton: 600n },
      members: [member({ userId: 'a' }), member({ userId: 'b' })],
    });
    expect(result.allocations).toHaveLength(0);
    expect(result.totalCarriedNanoton).toBe(1000n);
  });

  it('rejects a duplicated member', () => {
    expect(() =>
      calculateRewardCycle({ distributableNanoton: 10n, policy, members: [member({ userId: 'a' }), member({ userId: 'a' })] }),
    ).toThrow(/appears twice/);
  });

  it('rejects pool shares that do not total 100%', () => {
    expect(() =>
      calculateRewardCycle({ distributableNanoton: 10n, policy: { ...policy, growthBps: 1 }, members: [] }),
    ).toThrow(RewardEngineError);
  });

  it('builds a stable idempotency key', () => {
    expect(allocationIdempotencyKey('cycle-1', 'user-1', 'GROWTH')).toBe('cycle-1:user-1:GROWTH');
  });
});
