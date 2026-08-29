export type MembershipStatus = 'UNKNOWN' | 'ACTIVE' | 'LEFT' | 'BANNED' | 'REJOIN_COOLDOWN';
export type MembershipEventType = 'JOIN' | 'LEAVE' | 'REJOIN' | 'BAN' | 'UNBAN';

export interface MembershipState {
  status: MembershipStatus;
  firstJoinAt?: Date;
  currentJoinAt?: Date;
  lastLeaveAt?: Date;
  rejoinCount: number;
}

export interface MembershipTransition { next: MembershipState; event?: MembershipEventType }

export function applyMembershipObservation(state: MembershipState, isActive: boolean, observedAt: Date): MembershipTransition {
  if (state.status === 'BANNED') return { next: state };
  if (isActive) {
    if (state.status === 'UNKNOWN') return { next: { ...state, status: 'ACTIVE', firstJoinAt: observedAt, currentJoinAt: observedAt }, event: 'JOIN' };
    if (state.status === 'LEFT') return { next: { ...state, status: 'REJOIN_COOLDOWN', currentJoinAt: observedAt, rejoinCount: state.rejoinCount + 1 }, event: 'REJOIN' };
    return { next: state };
  }
  if (state.status === 'ACTIVE' || state.status === 'REJOIN_COOLDOWN') return { next: { ...state, status: 'LEFT', lastLeaveAt: observedAt }, event: 'LEAVE' };
  return { next: state };
}

export function completeRejoinCooldown(state: MembershipState): MembershipState {
  return state.status === 'REJOIN_COOLDOWN' ? { ...state, status: 'ACTIVE' } : state;
}

