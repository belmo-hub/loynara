import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialDemo, transition, type DemoAction, type DemoState } from '../src/demo.js';
import { initialRef, refTransition, type RefAction } from '../src/ref.js';
import { initialBrand } from '../src/brand.js';
import { visitScreen, visitStep, refVisual, refLit, standObj, phone, walletScreen, ownerViewsD } from '../src/d-parts.js';

const run = (s: DemoState, ...a: DemoAction[]) => a.reduce(transition, s);
const bal = (html: string) => Number(html.match(/(\d+) von 10 Stempeln/)![1]);

test('counter demo screen: the stamp appears only after staff confirmation; reward only at ten; redemption resets', () => {
  const s0 = initialDemo('returning');
  assert.equal(bal(visitScreen(s0)), 8); assert.match(visitScreen(s0), /Handy an den Tresen halten/); assert.match(visitScreen(s0), /Oder QR-Code scannen\./);
  const req = run(s0, { type: 'open' }); assert.equal(bal(visitScreen(req)), 8); assert.match(visitScreen(req), /Dein Team scannt und bestätigt/);
  const c1 = run(req, { type: 'confirm' }); assert.equal(bal(visitScreen(c1)), 9); assert.match(visitScreen(c1), /Stempel erhalten/);
  assert.equal(run(c1, { type: 'confirm' }), c1, 'a second confirm does nothing');
  const r = run(c1, { type: 'nextVisit' }, { type: 'confirm' }); assert.equal(bal(visitScreen(r)), 10); assert.match(visitScreen(r), /Prämie bereit/);
  assert.doesNotMatch(visitScreen(c1), /Prämie bereit/);
  const red = run(r, { type: 'redeem' }); assert.equal(bal(visitScreen(red)), 0); assert.match(visitScreen(red), /Prämie eingelöst/);
  assert.deepEqual([s0, req, c1, r, red].map(visitStep), [0, 1, 2, 3, 4]);
});
test('new card: no card before enrolment, no invented starter progress, first confirmed visit gives exactly one stamp', () => {
  const n = run(initialDemo('new'), { type: 'open' });
  assert.match(visitScreen(n), /Neue Karte erstellen/); assert.doesNotMatch(visitScreen(n), /von 10 Stempeln/);
  const e = run(n, { type: 'enroll' }); assert.equal(bal(visitScreen(e)), 0);
  const c = run(e, { type: 'confirm' }); assert.equal(bal(visitScreen(c)), 1);
  assert.equal(run(c, { type: 'nextVisit' }), c, 'a new card does not jump to a reward');
});
test('referral picture: no bonus for sharing, opening or joining; exactly one bonus after the first confirmed visit', () => {
  let r = initialRef();
  for (const a of ['share', 'open', 'join'] as RefAction[]) { r = refTransition(r, a); const html = refVisual(r); assert.match(html, /kein Bonus/); assert.doesNotMatch(html, /Bonusstempel/); assert.match(html, /<span>7<\/span>\/10/); }
  assert.equal(refLit(r), 2);
  r = refTransition(r, 'confirm'); const q = refVisual(r);
  assert.match(q, /\+1 Bonusstempel/); assert.match(q, /<span>8<\/span>\/10/); assert.match(q, /erster Besuch bestätigt/); assert.equal(refLit(r), 4);
  assert.equal(refTransition(r, 'confirm'), r, 'no duplicate bonus');
});
test('product objects: one brand on stand and phone, honest labels, nothing that looks like a provisioned pass or a send', () => {
  const b = { ...initialBrand(), logo: 'welle' as const };
  assert.match(standObj(b), /Gestaltungsbeispiel/); assert.match(standObj(b), /Antippen oder scannen/); assert.match(standObj(b), /aria-label="Aufsteller am Tresen mit NFC und QR-Code, Gestaltungsbeispiel"/); assert.doesNotMatch(standObj(b), /so-wave/, 'the stand changes only its text; no tap symbol is added');
  assert.match(phone(walletScreen(b)), /Wallet-Vorschau/); assert.doesNotMatch(phone(walletScreen(b)), /hinzufügen|Add to Wallet/i);
  for (const v of ['gone', 'quiet'] as const) { assert.match(ownerViewsD[v], /Plattform-Ausblick/); assert.match(ownerViewsD[v], /Vorschau · nicht versendet/); }
  assert.doesNotMatch(ownerViewsD.back, /Plattform-Ausblick/); assert.match(ownerViewsD.back, /Beispieldaten/);
});
