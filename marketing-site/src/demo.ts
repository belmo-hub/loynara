/**
 * The counter demonstration as one deterministic state machine. Customer, cashier and owner views are all derived from it.
 * Nothing here touches a network, storage or a real account; scrolling and "view" steps never call transition().
 */
import { DEMO } from './site.js';

export type Entry = 'nfc' | 'qr';
export type Identity = 'returning' | 'new';
export type Phase = 'start' | 'enroll' | 'request' | 'confirmed' | 'request2' | 'reward' | 'redeemed';
export type DemoState = { phase: Phase; entry: Entry; identity: Identity; enrolled: boolean };
export const initialDemo = (): DemoState => ({ phase: 'start', entry: 'nfc', identity: 'returning', enrolled: false });

export type DemoAction =
  | { type: 'entry'; entry: Entry } | { type: 'identity'; identity: Identity }
  | { type: 'open' } | { type: 'enroll' } | { type: 'confirm' } | { type: 'nextVisit' } | { type: 'redeem' } | { type: 'reset' };

/** Returns the same object when an action does not apply, so repeated clicks are idempotent. */
export function transition(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case 'reset': return initialDemo();
    case 'entry': return s.phase === 'start' && s.entry !== a.entry ? { ...s, entry: a.entry } : s;
    case 'identity': return s.phase === 'start' && s.identity !== a.identity ? { ...s, identity: a.identity } : s;
    case 'open': return s.phase !== 'start' ? s : { ...s, phase: s.identity === 'new' && !s.enrolled ? 'enroll' : 'request' };
    case 'enroll': return s.phase === 'enroll' && !s.enrolled ? { ...s, enrolled: true, phase: 'request' } : s;
    case 'confirm': return s.phase === 'request' ? { ...s, phase: 'confirmed' } : s.phase === 'request2' ? { ...s, phase: 'reward' } : s;
    case 'nextVisit': return s.phase === 'confirmed' ? { ...s, phase: 'request2' } : s;
    case 'redeem': return s.phase === 'reward' ? { ...s, phase: 'redeemed' } : s;
  }
}

export type DemoView = {
  balance: number; threshold: number; confirmedVisits: number; redemptions: number;
  pendingRequest: boolean; rewardReady: boolean; remaining: number;
  /** which of the four explanatory steps the current state belongs to (0…3) */
  guideStep: number;
};
export const GUIDE_STEPS = 4;
/** Every number any of the three views shows comes from here. */
export function viewOf(s: DemoState): DemoView {
  const visitsConfirmed = { start: 0, enroll: 0, request: 0, confirmed: 1, request2: 1, reward: 2, redeemed: 2 }[s.phase];
  const redemptions = s.phase === 'redeemed' ? 1 : 0;
  const balance = s.phase === 'redeemed' ? 0 : DEMO.startBalance + visitsConfirmed;
  const guideStep = { start: 0, enroll: 0, request: 1, confirmed: 2, request2: 2, reward: 3, redeemed: 3 }[s.phase];
  return {
    balance, threshold: DEMO.threshold, confirmedVisits: visitsConfirmed, redemptions,
    pendingRequest: s.phase === 'request' || s.phase === 'request2', rewardReady: s.phase === 'reward', remaining: Math.max(0, DEMO.threshold - balance), guideStep,
  };
}
