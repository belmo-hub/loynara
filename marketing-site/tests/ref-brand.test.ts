import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialRef, refTransition, refView, REF_RULE, type RefAction, type RefState } from '../src/ref.js';
import { initialBrand, STYLES, LOGOS, REWARD_LABELS, rewardText, brandVars, isStyle } from '../src/brand.js';
import { industries } from '../src/site.js';
import { standSvg, walletHtml, studioHtml, studioControls, cardHtml, brandCss } from '../src/final-parts.js';

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
test('brand: presets mirror the application card studio, markup follows logo and reward, every surface carries the same brand', () => {
  assert.deepEqual(Object.keys(STYLES), ['wald', 'terrakotta', 'nachtblau', 'pflaume', 'graphit']);
  assert.equal(Object.keys(LOGOS).length, 3); assert.equal(Object.keys(REWARD_LABELS).length, 3);
  for (const style of Object.keys(STYLES)) for (const logo of Object.keys(LOGOS)) for (const reward of Object.keys(REWARD_LABELS)) {
    const b = { style, logo, reward } as ReturnType<typeof initialBrand>;
    const text = rewardText(b, 'cafe').replace(/^./, c => c.toUpperCase());
    const pair = studioHtml(b, 'tresen'), wallet = studioHtml(b, 'wallet');
    for (const html of [pair, wallet]) { assert.ok(html.includes(industries.cafe.name)); assert.ok(html.includes(text), `${reward}: ${text}`); assert.doesNotMatch(html, /Zu Wallet hinzufügen|Add to Wallet/i); }
    assert.match(pair, /Gestaltungsbeispiel/); assert.match(wallet, /Wallet-Vorschau/); assert.match(pair, /class="stand"/); assert.match(pair, /class="lcard/);
    assert.ok(standSvg(b).includes(LOGOS[b.logo].svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')) && cardHtml({ balance: 8, status: 'x', brand: b }).includes(LOGOS[b.logo].svg) && walletHtml(b).includes(LOGOS[b.logo].svg), 'logo on stand, card and Wallet');
  }
  assert.match(brandVars({ ...initialBrand(), style: 'nachtblau' }), /--b-dark:#16264A/);
  assert.equal(isStyle('wald'), true); assert.equal(isStyle('x'), false);
  assert.match(studioControls(initialBrand()), /Farbe[\s\S]*Marke[\s\S]*Prämie/);
  assert.doesNotMatch(studioHtml(initialBrand(), 'tresen') + studioHtml(initialBrand(), 'wallet'), /https?:|<img|<input type="file"/);
});
test('brand CSS variables generated for the stylesheet are in sync with src/brand.ts', () => {
  const css = brandCss();
  for (const [k, s] of Object.entries(STYLES)) assert.ok(css.includes(`[data-brand="${k}"]{--b-dark:${s.dark};--b-mid:${s.mid};--b-accent:${s.accent};--b-soft:${s.soft}}`), k);
});
