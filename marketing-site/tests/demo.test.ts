import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialDemo, transition, balance, canAdvance, visits, type DemoAction, type DemoState } from '../src/demo.js';
import { industries, industryKeys } from '../src/site.js';
import { demoScreens, stepDescription, STEP_TITLES } from '../src/views.js';

const run = (s: DemoState, ...actions: DemoAction[]) => actions.reduce(transition, s);

test('NFC path: tap raises the request, only the team confirmation awards, and it is idempotent', () => {
  let s = initialDemo();
  assert.equal(canAdvance(s), false, 'an entry must be chosen first');
  s = run(s, 'nfc', 'next');
  assert.equal(s.step, 1);
  assert.equal(canAdvance(s), false, 'the card must exist before the visit');
  s = run(s, 'enroll', 'next');
  assert.equal(s.step, 2); assert.equal(s.requested, true, 'the tap itself raised the request');
  assert.equal(balance(s), 0, 'a request alone awards nothing');
  s = run(s, 'confirm'); assert.equal(balance(s), 1);
  assert.equal(balance(transition(s, 'confirm')), 1, 'confirming twice never awards twice');
});

test('QR path: the team has to find the card before it can confirm', () => {
  let s = run(initialDemo(), 'qr', 'next', 'enroll', 'next');
  assert.equal(s.requested, false);
  assert.equal(balance(transition(s, 'confirm')), 0);
  s = run(s, 'scan', 'confirm'); assert.equal(balance(s), 1);
  assert.equal(transition(initialDemo(), 'scan').requested, false, 'scan only works at the cashier step');
});

test('owner step: simulation reaches the reward once, redemption resets the balance, reset restores the start', () => {
  let s = run(initialDemo(5), 'nfc', 'next', 'enroll', 'next', 'confirm', 'next');
  assert.equal(s.step, 3);
  assert.equal(transition(s, 'redeem').redeemed, false, 'no reward before the threshold');
  s = run(s, 'more'); assert.equal(balance(s), 5); assert.equal(visits(s), 5);
  assert.equal(balance(transition(s, 'more')), 5, 'simulating twice does not overshoot');
  s = run(s, 'redeem'); assert.equal(balance(s), 0);
  assert.equal(transition(s, 'redeem'), s);
  assert.deepEqual(transition(s, 'reset'), initialDemo(5));
});

test('back keeps confirmed history and the entry choice is locked after enrolment', () => {
  let s = run(initialDemo(), 'nfc', 'next', 'enroll', 'next', 'confirm', 'back');
  assert.equal(balance(s), 1);
  s = run(initialDemo(), 'nfc', 'next', 'enroll', 'back', 'back');
  assert.equal(transition(s, 'qr').entry, 'nfc');
});

test('every industry is complete and its demo runs to the reward and redemption', () => {
  assert.equal(industryKeys.length, 8);
  const seen = new Set<string>();
  for (const key of industryKeys) {
    const x = industries[key];
    for (const field of ['label', 'name', 'reward', 'visit', 'intro', 'referral'] as const) assert.ok(x[field].trim().length > 8 || field === 'label', `${key}.${field}`);
    assert.ok(x.threshold >= 3 && x.threshold <= 10);
    assert.ok(!seen.has(x.reward), 'rewards differ between industries'); seen.add(x.reward);
    for (const entry of ['nfc', 'qr'] as const) {
      let s = initialDemo(x.threshold);
      s = run(s, entry, 'next', 'enroll', 'next', ...(entry === 'qr' ? ['scan' as const] : []), 'confirm', 'next', 'more');
      assert.equal(balance(s), x.threshold);
      assert.match(demoScreens(s, key), /Prämie einlösen/);
      s = run(s, 'redeem');
      assert.match(demoScreens(s, key), new RegExp(`−${x.threshold} Stempel`));
      for (const step of [0, 1, 2, 3]) assert.ok(stepDescription({ ...s, step }, key).length > 20 && STEP_TITLES[step]);
    }
  }
});
