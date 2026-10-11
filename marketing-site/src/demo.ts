/**
 * The counter demonstration as one deterministic state machine. Customer, cashier and owner views are all derived from it.
 * Nothing here touches a network, storage or a real account; scrolling and "view" steps never call transition().
 */
import { DEMO } from './site.js';

export type Entry = 'nfc' | 'qr';
export type Identity = 'returning' | 'new';
export type Phase = 'start' | 'enroll' | 'request' | 'confirmed' | 'request2' | 'reward' | 'redeemed';
export type DemoState = { phase: Phase; entry: Entry; identity: Identity; enrolled: boolean };
/** Two separate fixtures: a returning customer's example card (8/10) and a brand-new card that starts at 0. Reset keeps the chosen fixture. */
export const initialDemo = (identity: Identity = 'returning'): DemoState => ({ phase: 'start', entry: 'nfc', identity, enrolled: false });

export type DemoAction =
  | { type: 'entry'; entry: Entry } | { type: 'identity'; identity: Identity }
  | { type: 'open' } | { type: 'enroll' } | { type: 'confirm' } | { type: 'nextVisit' } | { type: 'redeem' } | { type: 'reset' } | { type: 'fixture'; identity: Identity };

/** Returns the same object when an action does not apply, so repeated clicks are idempotent. */
export function transition(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case 'reset': return initialDemo(s.identity);
    case 'fixture': return s.identity === a.identity && s.phase === 'start' ? s : initialDemo(a.identity);
    case 'entry': return s.phase === 'start' && s.entry !== a.entry ? { ...s, entry: a.entry } : s;
    case 'identity': return s.phase === 'start' && s.identity !== a.identity ? { ...s, identity: a.identity } : s;
    case 'open': return s.phase !== 'start' ? s : { ...s, phase: s.identity === 'new' && !s.enrolled ? 'enroll' : 'request' };
    case 'enroll': return s.phase === 'enroll' && !s.enrolled ? { ...s, enrolled: true, phase: 'request' } : s;
    case 'confirm': return s.phase === 'request' ? { ...s, phase: 'confirmed' } : s.phase === 'request2' ? { ...s, phase: 'reward' } : s;
    // a new card has no history: the demo shows its first confirmed visit and then offers the returning fixture
    case 'nextVisit': return s.phase === 'confirmed' && s.identity === 'returning' ? { ...s, phase: 'request2' } : s;
    case 'redeem': return s.phase === 'reward' ? { ...s, phase: 'redeemed' } : s;
  }
}

export type DemoView = {
  balance: number; threshold: number; confirmedVisits: number; redemptions: number;
  pendingRequest: boolean; rewardReady: boolean; remaining: number;
  /** the card exists (a new customer has none until they create it) */
  hasCard: boolean; cardLabel: string;
  /** which of the four explanatory steps the current state belongs to (0…3) */
  guideStep: number;
};
export const GUIDE_STEPS = 4;
/** Every number any of the three views shows comes from here. */
export function viewOf(s: DemoState): DemoView {
  const visitsConfirmed = { start: 0, enroll: 0, request: 0, confirmed: 1, request2: 1, reward: 2, redeemed: 2 }[s.phase];
  const redemptions = s.phase === 'redeemed' ? 1 : 0;
  const start = s.identity === 'new' ? 0 : DEMO.startBalance;
  const balance = s.phase === 'redeemed' ? 0 : start + visitsConfirmed;
  const hasCard = s.identity === 'returning' || s.enrolled;
  const guideStep = { start: 0, enroll: 0, request: 1, confirmed: 2, request2: 2, reward: 3, redeemed: 3 }[s.phase];
  return {
    balance, threshold: DEMO.threshold, confirmedVisits: visitsConfirmed, redemptions, hasCard, cardLabel: s.identity === 'new' ? 'Neue Karte' : DEMO.example,
    pendingRequest: s.phase === 'request' || s.phase === 'request2', rewardReady: s.phase === 'reward', remaining: Math.max(0, DEMO.threshold - balance), guideStep,
  };
}

/** The four journey chapters. Chapters 1-3 share the loyalty demo state; "refer" has its own referral state (src/ref.ts). */
export type Chapter = 'start' | 'collect' | 'reward' | 'refer';
export const CHAPTER_PHASES: Record<Exclude<Chapter, 'refer'>, Phase[]> = { start: ['start', 'enroll'], collect: ['request', 'confirmed'], reward: ['request2', 'reward', 'redeemed'] };
/**
 * Selecting a chapter is a view change, never a business event. If the current example state already belongs to the chapter it is kept;
 * otherwise the chapter's defined snapshot is loaded (collect: a visit waiting for confirmation; reward: the second visit of the returning
 * example). A new card has no reward path: it keeps its own state, and the UI offers the returning fixture.
 */
export function enterChapter(s: DemoState, chapter: Chapter): DemoState {
  if (chapter === 'refer') return s;
  if (CHAPTER_PHASES[chapter].includes(s.phase)) return s;
  if (chapter === 'start') return initialDemo(s.identity);
  if (chapter === 'collect') return { phase: 'request', entry: s.entry, identity: s.identity, enrolled: s.identity === 'new' };
  return s.identity === 'returning' ? { phase: 'request2', entry: s.entry, identity: 'returning', enrolled: false } : s;
}
export const chapterOf = (s: DemoState): Exclude<Chapter, 'refer'> => (Object.keys(CHAPTER_PHASES) as Array<keyof typeof CHAPTER_PHASES>).find(k => CHAPTER_PHASES[k].includes(s.phase))!;
