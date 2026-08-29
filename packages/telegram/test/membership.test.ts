import { describe, expect, it } from 'vitest';
import { applyMembershipObservation, completeRejoinCooldown } from '../src/index.js';

const joined = new Date('2026-08-01T00:00:00Z');
describe('membership state machine', () => {
  it('records an initial join without losing firstJoinAt', () => {
    const first = applyMembershipObservation({ status: 'UNKNOWN', rejoinCount: 0 }, true, joined);
    expect(first.event).toBe('JOIN');
    expect(first.next.firstJoinAt).toEqual(joined);
  });
  it('makes a leaving member rejoin once and require cooldown', () => {
    const active = { status: 'ACTIVE' as const, rejoinCount: 0, firstJoinAt: joined, currentJoinAt: joined };
    const left = applyMembershipObservation(active, false, new Date('2026-08-02'));
    const rejoined = applyMembershipObservation(left.next, true, new Date('2026-08-03'));
    expect(rejoined).toMatchObject({ event: 'REJOIN', next: { status: 'REJOIN_COOLDOWN', rejoinCount: 1, firstJoinAt: joined } });
    expect(completeRejoinCooldown(rejoined.next).status).toBe('ACTIVE');
  });
  it('does not overwrite an existing active member with duplicate checks', () => {
    const state = { status: 'ACTIVE' as const, rejoinCount: 0, firstJoinAt: joined, currentJoinAt: joined };
    expect(applyMembershipObservation(state, true, new Date('2026-08-02'))).toEqual({ next: state });
  });
});
