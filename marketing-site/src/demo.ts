/**
 * The visitor-facing walkthrough. A pure state machine: nothing here touches a network, storage or a real account.
 * Flow: the customer arrives by NFC tap or QR scan -> opens/creates a card -> the team confirms -> the owner sees it.
 */
export type Entry = 'nfc' | 'qr';
export type DemoState = { threshold: number; step: number; entry: Entry | null; enrolled: boolean; requested: boolean; confirmed: boolean; extra: number; redeemed: boolean };
export const STEPS = 4;
export const initialDemo = (threshold = 8): DemoState => ({ threshold, step: 0, entry: null, enrolled: false, requested: false, confirmed: false, extra: 0, redeemed: false });
export type DemoAction = 'nfc' | 'qr' | 'next' | 'back' | 'enroll' | 'scan' | 'confirm' | 'more' | 'redeem' | 'reset';

export const visits = (s: DemoState) => (s.confirmed ? 1 : 0) + s.extra;
export const balance = (s: DemoState) => (s.redeemed ? 0 : visits(s));
export function canAdvance(s: DemoState): boolean {
  if (s.step >= STEPS - 1) return false;
  if (s.step === 0) return s.entry !== null;
  if (s.step === 1) return s.enrolled;
  return s.confirmed;
}
export function transition(s: DemoState, action: DemoAction): DemoState {
  switch (action) {
    case 'reset': return initialDemo(s.threshold);
    case 'nfc': case 'qr': return s.step === 0 && !s.enrolled ? { ...s, entry: action } : s;
    case 'enroll': return s.step === 1 && s.entry ? { ...s, enrolled: true } : s;
    case 'next': {
      if (!canAdvance(s)) return s;
      // An NFC tap itself raises the request; a QR card has to be found by the team first.
      const step = s.step + 1;
      return { ...s, step, requested: s.requested || (step === 2 && s.entry === 'nfc') };
    }
    case 'back': return { ...s, step: Math.max(0, s.step - 1) };
    case 'scan': return s.step === 2 && s.entry === 'qr' && s.enrolled ? { ...s, requested: true } : s;
    case 'confirm': return s.step === 2 && s.requested && !s.confirmed ? { ...s, confirmed: true } : s;
    case 'more': return s.step === 3 && s.confirmed && s.extra === 0 && !s.redeemed ? { ...s, extra: s.threshold - 1 } : s;
    case 'redeem': return s.step === 3 && balance(s) === s.threshold ? { ...s, redeemed: true } : s;
  }
}
