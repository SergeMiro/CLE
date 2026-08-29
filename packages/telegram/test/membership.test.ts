import { describe, expect, it } from 'vitest';
import { applyMembershipObservation, completeRejoinCooldown, type MembershipState } from '../src/index.js';

const at = new Date('2026-08-29T12:00:00Z');
const later = new Date('2026-09-05T12:00:00Z');

describe('membership state machine', () => {
  it('records a first join', () => {
    const { next, event } = applyMembershipObservation({ status: 'UNKNOWN', rejoinCount: 0 }, true, at);
    expect(event).toBe('JOIN');
    expect(next).toMatchObject({ status: 'ACTIVE', firstJoinAt: at, currentJoinAt: at });
  });

  it('records a leave', () => {
    const state: MembershipState = { status: 'ACTIVE', rejoinCount: 0, firstJoinAt: at, currentJoinAt: at };
    const { next, event } = applyMembershipObservation(state, false, later);
    expect(event).toBe('LEAVE');
    expect(next).toMatchObject({ status: 'LEFT', lastLeaveAt: later });
  });

  it('puts a rejoin into cooldown and counts it', () => {
    const state: MembershipState = { status: 'LEFT', rejoinCount: 0, firstJoinAt: at, lastLeaveAt: at };
    const { next, event } = applyMembershipObservation(state, true, later);
    expect(event).toBe('REJOIN');
    expect(next).toMatchObject({ status: 'REJOIN_COOLDOWN', rejoinCount: 1, currentJoinAt: later });
  });

  it('is idempotent for repeated identical observations', () => {
    const state: MembershipState = { status: 'ACTIVE', rejoinCount: 0, currentJoinAt: at };
    const { next, event } = applyMembershipObservation(state, true, later);
    expect(event).toBeUndefined();
    expect(next).toBe(state);
  });

  it('never resurrects a banned member', () => {
    const state: MembershipState = { status: 'BANNED', rejoinCount: 0 };
    expect(applyMembershipObservation(state, true, later).next.status).toBe('BANNED');
  });

  it('completes a cooldown into active membership', () => {
    expect(completeRejoinCooldown({ status: 'REJOIN_COOLDOWN', rejoinCount: 1 }).status).toBe('ACTIVE');
    expect(completeRejoinCooldown({ status: 'LEFT', rejoinCount: 1 }).status).toBe('LEFT');
  });
});
