import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialDemo, transition, viewOf, enterChapter, chapterOf, CHAPTER_PHASES, type DemoAction, type DemoState } from '../src/demo.js';
import { DEMO, industries, industryKeys } from '../src/site.js';
import { journeyStage, ownerBody, OWNER_VIEWS, nearMessage, OWNER_BADGE, MESSAGE_TAG, CHAPTERS } from '../src/views.js';
import { initialRef } from '../src/ref.js';
import { initialBrand, rewardText } from '../src/brand.js';

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

test('missing-regular scenes: the pause always exceeds the stated usual interval (in days)', () => {
  const days = (text: string) => { const m = text.match(/(\d+) (Tage|Wochen|Monate)/g) ?? []; const toDays = (t: string) => { const [n, u] = t.split(' '); return Number(n) * ({ Tage: 1, Wochen: 7, Monate: 30 } as Record<string, number>)[u]; }; return m.map(toDays); };
  for (const key of industryKeys) {
    const story = industries[key].regular.story, parts = story.split('–'); assert.equal(parts.length, 2, key);
    const usualMax = Math.max(...days(parts[0].replace(/bis (\d+)/, '$1')));
    const pause = Math.min(...days(parts[1]));
    assert.ok(pause > usualMax, `${key}: pause ${pause} must exceed usual ${usualMax}`);
  }
});

const brand = initialBrand(), ref = initialRef();
const stage = (c: Parameters<typeof journeyStage>[0], d: DemoState, key: (typeof industryKeys)[number]) => journeyStage(c, d, ref, key, brand, true);

test('chapter selection is a view change: snapshots only when the state does not already belong to the chapter, never a business event', () => {
  const fresh = initialDemo();
  assert.equal(enterChapter(fresh, 'start'), fresh);
  const collect = enterChapter(fresh, 'collect'); assert.deepEqual([collect.phase, viewOf(collect).balance, viewOf(collect).confirmedVisits], ['request', 8, 0]);
  const reward = enterChapter(fresh, 'reward'); assert.deepEqual([reward.phase, viewOf(reward).balance], ['request2', 9]);
  assert.equal(enterChapter(collect, 'collect'), collect, 'a state already inside the chapter is kept');
  const confirmed = run(collect, A.confirm); assert.equal(chapterOf(confirmed), 'collect'); assert.equal(enterChapter(confirmed, 'collect'), confirmed);
  const toReward = enterChapter(confirmed, 'reward'); assert.equal(toReward.phase, 'request2'); assert.equal(viewOf(toReward).balance, 9);
  assert.equal(viewOf(enterChapter(confirmed, 'start')).balance, 8, 'going back to Starten reloads the start snapshot');
  assert.equal(enterChapter(fresh, 'refer'), fresh, 'the referral chapter leaves the loyalty state alone');
  for (const c of Object.keys(CHAPTER_PHASES)) for (const p of CHAPTER_PHASES[c as keyof typeof CHAPTER_PHASES]) assert.equal(chapterOf({ ...fresh, phase: p }), c);
});
test('new card: chapters are consistent (collect keeps zero, reward is not reachable and offers the returning fixture)', () => {
  const n = initialDemo('new');
  const c = enterChapter(n, 'collect'); assert.deepEqual([c.phase, c.enrolled, viewOf(c).balance], ['request', true, 0]);
  assert.equal(viewOf(run(c, A.confirm)).balance, 1);
  assert.equal(enterChapter(n, 'reward'), n, 'no invented reward for a new card');
  assert.match(stage('reward', n, 'cafe'), /Eine neue Karte braucht zehn bestätigte Besuche/); assert.match(stage('reward', n, 'cafe'), /data-action="use-returning"/);
});
test('every number in the three journey panels comes from one state, in every industry', () => {
  for (const key of industryKeys) for (const chapter of ['start', 'collect', 'reward'] as const) {
    let s = enterChapter(initialDemo(), chapter);
    for (const a of [A.open, A.confirm, A.next, A.confirm, A.redeem]) {
      s = transition(s, a); const v = viewOf(s), html = stage(chapter, s, key);
      assert.match(html, new RegExp(`data-visits>${v.confirmedVisits}<`)); assert.match(html, new RegExp(`data-redemptions>${v.redemptions}<`));
      if (v.hasCard) assert.match(html, new RegExp(`<strong data-owner-balance>${v.balance} / ${v.threshold}<`));
    }
  }
});
test('every industry: reward grammar, complete sentences, outlook labelling and brand reward options read correctly', () => {
  const rewards = new Set<string>();
  for (const key of industryKeys) {
    const x = industries[key]; rewards.add(x.reward);
    for (const f of [x.name, x.reward, x.visit, x.intro, x.referral, x.quiet.message, x.quiet.when, x.regular.who, x.regular.story, x.regular.pause, x.quiet.outcome]) assert.ok(f.length > 6, key);
    for (const sentence of [x.quiet.message, x.quiet.outcome, x.regular.story]) assert.match(sentence, /^[A-ZÄÖÜ]/);
    for (const r of ['branche', 'aufmerksamkeit', 'extra'] as const) assert.match(nearMessage(rewardText({ ...brand, reward: r }, key)), /^Noch ein Besuch – dann wartet (ein|eine) [^.]+ auf dich\.$/);
    assert.ok(stage('collect', run(enterChapter(initialDemo(), 'collect'), A.confirm), key).includes(x.name));
    for (const v of OWNER_VIEWS) for (const revealed of [false, true]) assert.ok(ownerBody(v.id, key, revealed).length > 80);
    for (const v of ['quiet', 'win'] as const) { const html = ownerBody(v, key, true); assert.match(html, new RegExp(OWNER_BADGE)); assert.match(html, /Versand ist nicht Teil des aktuellen Angebots/); assert.doesNotMatch(html, /Jetzt senden|gesendet|Zugestellt|Du bemerkst|automatisch erkannt/i); }
    assert.match(ownerBody('quiet', key, false), /Denkbar: Karten mit Kontakt-Einwilligung/);
    assert.match(ownerBody('win', key, false), new RegExp(x.regular.who));
  }
  assert.equal(rewards.size, 8); assert.equal(CHAPTERS.length, 4); assert.equal(MESSAGE_TAG, 'Vorschau – Versand ist nicht Teil des aktuellen Angebots');
  assert.equal(OWNER_VIEWS.filter(v => v.outlook).length, 2); assert.equal(OWNER_VIEWS.find(v => v.id === 'overview')!.outlook, false);
});
