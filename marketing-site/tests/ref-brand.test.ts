import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialRef, refTransition, refView, REF_RULE, type RefAction, type RefState } from '../src/ref.js';
import { initialBrand, STYLES, LOGOS, REWARD_LABELS, rewardText, brandVars, isStyle } from '../src/brand.js';
import { industryKeys, industries } from '../src/site.js';
import { refStage, standSvg, studioComposition, walletPass, studioControls } from '../src/views.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const run = (s: RefState, ...a: RefAction[]) => a.reduce(refTransition, s);

test('referral: sharing or opening a link earns nothing; the bonus is booked once, after the friend’s first confirmed visit', () => {
  let s = initialRef(); let v = refView(s);
  assert.deepEqual([v.referrerBalance, v.friendBalance, v.qualifiedReferrals, v.bonusBooked, v.step], [7, null, 0, 0, -1]);
  s = run(s, 'share'); v = refView(s); assert.deepEqual([v.referrerBalance, v.qualifiedReferrals, v.bonusBooked, v.friendJoined], [7, 0, 0, false]);
  s = run(s, 'open'); v = refView(s); assert.deepEqual([v.referrerBalance, v.qualifiedReferrals, v.friendJoined, s.phase], [7, 0, false, 'opened']);
  s = run(s, 'join'); v = refView(s); assert.deepEqual([v.friendBalance, v.friendJoined, v.qualifiedReferrals, v.referrerBalance, v.pendingRequest, v.step], [0, true, 0, 7, true, 1]);
  s = run(s, 'confirm'); v = refView(s);
  assert.deepEqual([v.friendBalance, v.referrerBalance, v.qualifiedReferrals, v.confirmedVisits, v.bonusBooked, v.step], [1, 7 + REF_RULE.referrerBonus, 1, 1, REF_RULE.referrerBonus, 3]);
});
test('referral: steps cannot be skipped, repeated clicks never duplicate a join or a bonus, reset restores everything', () => {
  const fresh = initialRef();
  for (const a of ['open', 'join', 'confirm'] as const) assert.equal(refTransition(fresh, a), fresh, `${a} needs its predecessor`);
  const done = run(fresh, 'share', 'open', 'join', 'confirm');
  for (const a of ['share', 'open', 'join', 'confirm'] as const) assert.equal(refTransition(done, a), done);
  const spam = run(fresh, 'share', 'share', 'open', 'open', 'join', 'join', 'confirm', 'confirm', 'confirm');
  assert.deepEqual(spam, done); assert.equal(refView(spam).bonusBooked, 1);
  assert.deepEqual(refTransition(spam, 'reset'), fresh);
  assert.equal(refTransition(run(fresh, 'share'), 'confirm').phase, 'shared');
});
test('referral stage: no bonus text before qualification, friend gets no reward claim, rule line states the real condition', () => {
  for (const key of industryKeys) {
    const brand = initialBrand();
    for (const [phase, bonus] of [['idle', false], ['shared', false], ['opened', false], ['joined', false], ['qualified', true]] as const) {
      const html = refStage({ phase }, key, brand, { interactive: true });
      assert.equal(/\+1 Empfehlungsbonus|Bonus einmal verbucht/.test(html), bonus, phase);
      assert.match(html, /sobald dein Team den ersten Besuch des Freundes bestätigt/); assert.match(html, /Ein Bonus für den Freund ist einstellbar/);
      assert.doesNotMatch(html, /Freund (erhält|bekommt) (einen )?Bonus|Willkommensbonus/);
      assert.match(html, new RegExp(`data-ref-qualified>${bonus ? 1 : 0}<`));
    }
    assert.match(refStage({ phase: 'shared' }, key, brand, { interactive: true }), /nichts wurde versendet/);
    assert.match(refStage({ phase: 'opened' }, key, brand, { interactive: true }), /Das Öffnen allein bringt keinen Bonus/);
  }
});
test('brand: presets mirror the application card studio, state is separate, reward options are grammatical, markup uses the brand', () => {
  assert.deepEqual(Object.keys(STYLES), ['wald', 'terrakotta', 'nachtblau', 'pflaume', 'graphit']);
  assert.equal(Object.keys(LOGOS).length, 3); assert.equal(Object.keys(REWARD_LABELS).length, 3);
  for (const key of industryKeys) {
    for (const style of Object.keys(STYLES)) for (const logo of Object.keys(LOGOS)) for (const reward of Object.keys(REWARD_LABELS)) {
      const b = { style, logo, reward } as ReturnType<typeof initialBrand>;
      const html = studioComposition(b, key); assert.ok(html.includes(industries[key].name)); assert.ok(html.includes(rewardText(b, key).replace(/^./, c => c.toUpperCase())) || html.includes(rewardText(b, key)));
      assert.match(html, /Gestaltungsbeispiel/); assert.match(html, /Wallet-Vorschau/); assert.doesNotMatch(html, /Zu Wallet hinzufügen|Add to Wallet/i);
    }
  }
  assert.match(brandVars({ ...initialBrand(), style: 'nachtblau' }), /--b-dark:#16264A/);
  assert.equal(isStyle('wald'), true); assert.equal(isStyle('x'), false);
  assert.match(studioControls(initialBrand()), /Markenstil[\s\S]*Logo[\s\S]*Prämie/);
  assert.match(standSvg(initialBrand(), 'Café Morgenlicht'), /role="img"/); assert.match(walletPass(initialBrand(), 'cafe'), /STEMPEL/);
});
test('brand CSS variables in styles.css are in sync with src/brand.ts', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../styles.css'), 'utf8');
  for (const [k, s] of Object.entries(STYLES)) { assert.ok(css.includes(`html[data-brand-style="${k}"] [data-brand-scope]{--b-dark:${s.dark};--b-mid:${s.mid};--b-accent:${s.accent};--b-soft:${s.soft}}`), k); }
});
