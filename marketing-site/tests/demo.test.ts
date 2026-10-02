import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialDemo, transition, viewOf, type DemoAction, type DemoState } from '../src/demo.js';
import { DEMO, industries, industryKeys } from '../src/site.js';
import { demoStage, MOMENTS, momentBody, guideHtml, guideBody, guideState, GUIDE_TITLES, nearMessage, MOMENT_BADGE, MESSAGE_TAG } from '../src/views.js';

const run = (s: DemoState, ...actions: DemoAction[]) => actions.reduce(transition, s);
const A = { nfc: { type: 'entry', entry: 'nfc' }, qr: { type: 'entry', entry: 'qr' }, open: { type: 'open' }, enroll: { type: 'enroll' }, confirm: { type: 'confirm' }, next: { type: 'nextVisit' }, redeem: { type: 'redeem' }, reset: { type: 'reset' }, isNew: { type: 'identity', identity: 'new' }, toReturning: { type: 'fixture', identity: 'returning' } } as const satisfies Record<string, DemoAction>;

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

test('a NEW card starts at 0, earns exactly one stamp after staff confirmation and has no invented history', () => {
  let s = run(initialDemo(), A.isNew, A.qr, A.open);
  assert.equal(s.phase, 'enroll'); assert.equal(s.entry, 'qr');
  let v = viewOf(s); assert.deepEqual([v.hasCard, v.balance, v.confirmedVisits], [false, 0, 0]);
  assert.equal(transition(s, A.confirm), s, 'cannot confirm before the card exists');
  s = run(s, A.enroll); assert.equal(s.phase, 'request'); assert.equal(s.enrolled, true);
  assert.equal(transition(s, A.enroll), s);
  v = viewOf(s); assert.deepEqual([v.hasCard, v.balance, v.confirmedVisits, v.cardLabel], [true, 0, 0, 'Neue Karte']);
  assert.equal(transition(s, { type: 'entry', entry: 'nfc' }), s, 'entry is fixed once the visit has started');
  s = run(s, A.confirm); v = viewOf(s);
  assert.deepEqual([v.balance, v.confirmedVisits, v.redemptions], [1, 1, 0]);
  assert.equal(transition(s, A.confirm), s, 'confirming twice never awards twice');
  assert.equal(transition(s, A.next), s, 'a new card has no second demo visit; the returning fixture is offered instead');
  assert.equal(transition(s, A.redeem), s);
  const back = run(s, A.toReturning); assert.deepEqual(back, initialDemo('returning'));
  assert.equal(viewOf(back).balance, 8);
});

test('fixtures stay separate: reset keeps the chosen fixture, the returning card is never touched by a new-card run', () => {
  const s = run(initialDemo(), A.isNew, A.open, A.enroll, A.confirm);
  assert.equal(transition(s, A.reset).identity, 'new'); assert.equal(viewOf(transition(s, A.reset)).balance, 0);
  assert.equal(viewOf(initialDemo('returning')).balance, 8);
  assert.equal(transition(initialDemo('new'), A.toReturning).identity, 'returning');
});

test('the guide is derived from state, shows one explanation, and never reads scroll position', () => {
  let s = initialDemo();
  const steps = (st: typeof s) => viewOf(st).guideStep;
  assert.equal(steps(s), 0);
  assert.equal(steps(run(s, A.open)), 1); assert.equal(steps(run(s, A.open, A.confirm)), 2);
  assert.equal(steps(run(s, A.open, A.confirm, A.next, A.confirm)), 3);
  for (const st of [s, run(s, A.open), run(s, A.open, A.confirm), run(s, A.open, A.confirm, A.next, A.confirm, A.redeem)]) {
    const html = guideHtml(st); assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
    assert.equal((html.match(/class="is-current"/g) ?? []).length, 1); assert.equal(GUIDE_TITLES.length, 4);
  }
  assert.equal(guideState(3, run(s, A.open, A.confirm, A.next, A.confirm, A.redeem)), 'done');
  const fresh = run(initialDemo(), A.isNew, A.open, A.enroll, A.confirm);
  assert.match(guideBody(2, 'new'), /Der Fortschritt beginnt mit dem ersten bestätigten Besuch/); assert.equal(guideState(3, fresh), 'later');
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
    for (const f of [x.name, x.reward, x.visit, x.intro, x.referral, x.quiet.message, x.quiet.when, x.regular.who, x.regular.story, x.regular.pause, x.quiet.outcome]) assert.ok(f.length > 6, `${key}`);
    const html = demoStage(run(initialDemo(), A.open, A.confirm), key, true);
    assert.ok(html.includes(x.name) && html.toLowerCase().includes(x.reward.slice(0, 12).toLowerCase()));
    // scene copy: sentences are complete and capitalised, the pause is longer than the usual rhythm, the reward sentence reads correctly
    for (const sentence of [x.quiet.message, x.quiet.outcome, x.regular.story]) assert.match(sentence, /^[A-ZÄÖÜ]/);
    assert.match(nearMessage(x.reward), new RegExp(`^Noch ein Besuch – dann wartet ${x.reward} auf dich\\.$`));
    for (const m of MOMENTS) for (const revealed of [false, true]) assert.ok(momentBody(m.id, key, revealed).length > 100);
    assert.ok(momentBody('quiet', key, true).includes(x.quiet.message.slice(0, 20)));
    assert.match(momentBody('missing', key, false), new RegExp(x.regular.who));
  }
  assert.equal(rewards.size, 8);
});

test('previews are never presented as sent or as part of the current offer', () => {
  assert.equal(MOMENT_BADGE, 'Plattform-Ausblick – nicht im aktuellen Pilotangebot'); assert.equal(MESSAGE_TAG, 'Vorschau – Versand ist nicht Teil des aktuellen Angebots');
  for (const m of MOMENTS) for (const key of industryKeys) { const html = momentBody(m.id, key, true); assert.match(html, /Versand ist nicht Teil des aktuellen Angebots/); assert.doesNotMatch(html, /Jetzt senden|gesendet|Zugestellt|Du bemerkst|automatisch erkannt/i); }
  for (const key of industryKeys) assert.match(momentBody('quiet', key, false), /Denkbar: Karten mit Kontakt-Einwilligung/);
});

test('missing-regular scenes: the pause always exceeds the stated usual interval (in days)', () => {
  const days = (text: string) => { const m = text.match(/(\d+) (Tage|Wochen|Monate)/g) ?? []; const toDays = (t: string) => { const [n, u] = t.split(' '); return Number(n) * ({ Tage: 1, Wochen: 7, Monate: 30 } as Record<string, number>)[u]; }; return m.map(toDays); };
  for (const key of industryKeys) {
    const story = industries[key].regular.story, parts = story.split('–'); assert.equal(parts.length, 2, key);
    const usualMax = Math.max(...days(parts[0].replace(/bis (\d+)/, '$1')));
    const pause = Math.min(...days(parts[1]));
    assert.ok(pause > usualMax, `${key}: pause ${pause} must exceed usual ${usualMax}`);
  }
});
