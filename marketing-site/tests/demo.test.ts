import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialDemo, transition, viewOf, type DemoAction, type DemoState } from '../src/demo.js';
import { DEMO, industries, industryKeys } from '../src/site.js';
import { demoStage, MOMENTS, momentBody, GUIDE } from '../src/views.js';

const run = (s: DemoState, ...actions: DemoAction[]) => actions.reduce(transition, s);
const A = { nfc: { type: 'entry', entry: 'nfc' }, qr: { type: 'entry', entry: 'qr' }, open: { type: 'open' }, enroll: { type: 'enroll' }, confirm: { type: 'confirm' }, next: { type: 'nextVisit' }, redeem: { type: 'redeem' }, reset: { type: 'reset' }, isNew: { type: 'identity', identity: 'new' } } as const satisfies Record<string, DemoAction>;

test('fixture: eight of ten stamps, no demo visits or redemptions at reset', () => {
  const v = viewOf(initialDemo());
  assert.deepEqual([v.balance, v.threshold, v.confirmedVisits, v.redemptions, v.pendingRequest], [DEMO.startBalance, 10, 0, 0, false]);
  assert.deepEqual([DEMO.startBalance, DEMO.threshold], [8, 10]);
});

test('no stamp exists before staff confirmation; confirming gives exactly one and is idempotent', () => {
  let s = run(initialDemo(), A.open);
  assert.equal(s.phase, 'request'); assert.equal(viewOf(s).balance, 8); assert.equal(viewOf(s).pendingRequest, true);
  s = run(s, A.confirm); assert.equal(viewOf(s).balance, 9); assert.equal(viewOf(s).confirmedVisits, 1);
  const again = transition(s, A.confirm); assert.equal(again, s, 'second confirm changes nothing');
  assert.equal(viewOf(s).remaining, 1);
});

test('second visit reaches ten, redemption resets the card, owner counts two visits and one redemption', () => {
  let s = run(initialDemo(), A.open, A.confirm, A.next);
  assert.equal(s.phase, 'request2'); assert.equal(viewOf(s).balance, 9);
  s = run(s, A.confirm); assert.equal(s.phase, 'reward'); assert.equal(viewOf(s).balance, 10); assert.equal(viewOf(s).rewardReady, true);
  assert.equal(transition(s, A.next), s, 'no third visit before redeeming');
  s = run(s, A.redeem); const v = viewOf(s);
  assert.deepEqual([v.balance, v.confirmedVisits, v.redemptions], [0, 2, 1]);
  assert.equal(transition(s, A.redeem), s); assert.equal(transition(s, A.confirm), s);
  assert.deepEqual(transition(s, A.reset), initialDemo());
});

test('repeated rapid actions never duplicate a business effect', () => {
  const s = run(initialDemo(), A.open, A.open, A.open, A.confirm, A.confirm, A.confirm, A.next, A.next, A.next, A.confirm, A.confirm, A.redeem, A.redeem, A.redeem);
  const v = viewOf(s); assert.deepEqual([v.balance, v.confirmedVisits, v.redemptions], [0, 2, 1]);
});

test('first-time customer enrols once, without creating a second identity', () => {
  let s = run(initialDemo(), A.isNew, A.qr, A.open);
  assert.equal(s.phase, 'enroll'); assert.equal(s.entry, 'qr');
  assert.equal(transition(s, A.confirm), s, 'cannot confirm before the card exists');
  s = run(s, A.enroll); assert.equal(s.phase, 'request'); assert.equal(s.enrolled, true);
  assert.equal(transition(s, A.enroll), s); assert.equal(viewOf(s).balance, 8);
  assert.equal(transition(s, { type: 'entry', entry: 'nfc' }), s, 'entry is fixed once the visit has started');
});

test('every number in customer, cashier and owner views comes from one state', () => {
  for (const key of industryKeys) {
    let s = initialDemo();
    for (const a of [A.open, A.confirm, A.next, A.confirm, A.redeem]) {
      s = transition(s, a); const v = viewOf(s), html = demoStage(s, key, true);
      assert.match(html, new RegExp(`data-balance>${v.balance}<small> / ${v.threshold}`));
      assert.match(html, new RegExp(`data-visits>${v.confirmedVisits}<`)); assert.match(html, new RegExp(`data-redemptions>${v.redemptions}<`));
      assert.match(html, new RegExp(`<strong data-owner-balance>${v.balance} / ${v.threshold}<`));
    }
  }
});

test('each industry changes reward and nouns; every scene is complete', () => {
  const rewards = new Set<string>();
  for (const key of industryKeys) {
    const x = industries[key]; rewards.add(x.reward);
    for (const f of [x.name, x.reward, x.visit, x.intro, x.referral, x.quiet.message, x.quiet.when, x.regular.who, x.regular.rhythm]) assert.ok(f.length > 6, `${key}`);
    const html = demoStage(run(initialDemo(), A.open, A.confirm), key, true);
    assert.ok(html.includes(x.name) && html.toLowerCase().includes(x.reward.slice(0, 12).toLowerCase()));
    for (const m of MOMENTS) for (const revealed of [false, true]) assert.ok(momentBody(m.id, key, revealed).length > 100);
    assert.ok(momentBody('quiet', key, true).includes(x.quiet.message.slice(0, 20)));
    assert.match(momentBody('missing', key, false), new RegExp(x.regular.who));
  }
  assert.equal(rewards.size, 8); assert.equal(GUIDE.length, 4);
});

test('previews are never presented as sent: no send control, explicit "nicht versendet" label', () => {
  for (const m of MOMENTS) { const html = momentBody(m.id, 'cafe', true); assert.match(html, /nicht versendet/); assert.doesNotMatch(html, /Jetzt senden|gesendet|Zugestellt/i); }
});
