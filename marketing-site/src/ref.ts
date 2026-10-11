/**
 * The referral example as its own deterministic state machine (separate from the loyalty demo and the brand state).
 * Rule, verified against the application code (src/lib/referrals.ts): opening or sharing a link earns nothing; a referral is
 * attributed when the friend joins (status "pending"); the bonus is booked once, when staff confirm the friend's FIRST earning visit.
 * Demonstration data only: no real link, no contacts, no message is sent.
 */
import { DEMO } from './site.js';

export type RefPhase = 'idle' | 'shared' | 'opened' | 'joined' | 'qualified';
export type RefState = { phase: RefPhase };
export const initialRef = (): RefState => ({ phase: 'idle' });
export type RefAction = 'share' | 'open' | 'join' | 'confirm' | 'reset';

/** Example programme rule: +1 bonus stamp for the referrer; a bonus for the friend is configurable (not shown as granted). */
export const REF_RULE = { referrerBonus: 1, referrerStart: 7 } as const;

/** Returns the same object when an action does not apply, so repeated clicks never duplicate a join or a bonus. */
export function refTransition(s: RefState, a: RefAction): RefState {
  switch (a) {
    case 'reset': return initialRef();
    case 'share': return s.phase === 'idle' ? { phase: 'shared' } : s;
    case 'open': return s.phase === 'shared' ? { phase: 'opened' } : s;
    case 'join': return s.phase === 'opened' ? { phase: 'joined' } : s;
    case 'confirm': return s.phase === 'joined' ? { phase: 'qualified' } : s;
  }
}

export const REF_STEPS = ['Link geteilt', 'Teilnahme offen', 'Bedingung erfüllt', 'Bonus verbucht'] as const;
export type RefView = {
  referrerBalance: number; friendBalance: number | null; friendJoined: boolean; linkShared: boolean;
  /** which of the four status steps is current (-1: nothing shared yet) */
  step: number; qualifiedReferrals: number; confirmedVisits: number; bonusBooked: number; pendingRequest: boolean;
};
export function refView(s: RefState): RefView {
  const order: RefPhase[] = ['idle', 'shared', 'opened', 'joined', 'qualified'];
  const i = order.indexOf(s.phase);
  const qualified = s.phase === 'qualified';
  return {
    referrerBalance: REF_RULE.referrerStart + (qualified ? REF_RULE.referrerBonus : 0),
    friendBalance: i >= 3 ? (qualified ? 1 : 0) : null, friendJoined: i >= 3, linkShared: i >= 1,
    step: s.phase === 'idle' ? -1 : s.phase === 'shared' || s.phase === 'opened' ? 0 : s.phase === 'joined' ? 1 : 3,
    qualifiedReferrals: qualified ? 1 : 0, confirmedVisits: qualified ? 1 : 0, bonusBooked: qualified ? REF_RULE.referrerBonus : 0, pendingRequest: s.phase === 'joined',
  };
}
export const refThreshold = DEMO.threshold;
