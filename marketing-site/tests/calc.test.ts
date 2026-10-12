import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, series, parseField, EXAMPLE, LIMITS, euro, signedEuro, ratioText, compactEuro, niceScale, formatNumber, type Inputs, type FieldKey } from '../src/calc.js';
import { SITE } from '../src/site.js';

const FEE = SITE.price.amount;
const with_ = (patch: Partial<Inputs>): Inputs => ({ ...EXAMPLE, ...patch });

test('the fee comes from the single site configuration', () => { assert.equal(FEE, 49); });

test('Loynara example: 50 purchases × €7 × 26 days, +10 %, €49 fee', () => {
  const s = compute(EXAMPLE, FEE);
  assert.equal(s.baseline, 9100); assert.equal(s.additional, 910); assert.equal(s.scenario, 10010);
  assert.equal(s.difference, 861); assert.equal(s.annualised, 10332);
  assert.equal(Math.round((s.ratio ?? 0) * 10) / 10, 18.6);
  assert.equal(ratioText(s.ratio), '18,6×');
  assert.equal(euro(s.annualised), '10.332 €'); assert.equal(euro(s.baseline), '9.100 €');
});

test('reference case observed on fidelix.ma (50 × 70 × 26, +10 %, fee 397) is reproduced by the same formula', () => {
  const s = compute({ visits: 50, basket: 70, days: 26, gain: 10 }, 397);
  assert.equal(s.additional, 9100); assert.equal(s.difference, 8703); assert.equal(s.annualised, 104436);
  assert.equal(Math.round(s.ratio!), 23);
  // further cases read from the live page while changing one input at a time
  assert.equal(compute({ visits: 100, basket: 70, days: 26, gain: 10 }, 397).difference, 17803);
  assert.equal(compute({ visits: 50, basket: 70, days: 26, gain: 5 }, 397).difference, 4153);
  const low = compute({ visits: 10, basket: 20, days: 20, gain: 20 }, 397);
  assert.equal(low.additional, 800); assert.equal(low.annualised, 4836); assert.equal(ratioText(low.ratio).startsWith('2,0'), true);
});

test('zero increase is shown honestly as a negative difference', () => {
  const s = compute(with_({ gain: 0 }), FEE);
  assert.equal(s.additional, 0); assert.equal(s.difference, -49); assert.equal(s.annualised, -588); assert.equal(s.ratio, 0);
  assert.equal(signedEuro(s.difference), '−49 €'); assert.equal(ratioText(s.ratio), '0×');
});

test('zero customers, basket or opening days; zero fee gives "not applicable", never Infinity', () => {
  for (const patch of [{ visits: 0 }, { basket: 0 }, { days: 0 }] as Partial<Inputs>[]) {
    const s = compute(with_(patch), FEE); assert.equal(s.baseline, 0); assert.equal(s.additional, 0); assert.equal(s.difference, -49);
  }
  const free = compute(EXAMPLE, 0);
  assert.equal(free.ratio, null); assert.equal(ratioText(free.ratio), 'nicht anwendbar'); assert.equal(free.difference, 910);
});

test('fractional basket and gain use exact cent arithmetic', () => {
  const s = compute({ visits: 33, basket: 7.35, days: 26, gain: 12.5 }, FEE);
  assert.equal(s.baseline, 6306.3); assert.equal(s.additional, 788.29); // 6306.30 × 0.125 = 788.2875
  const t = compute({ visits: 1, basket: 0.1, days: 3, gain: 0.1 }, FEE); assert.equal(t.baseline, 0.3); assert.equal(t.additional, 0);
});

test('maximum allowed values stay finite and formattable', () => {
  const s = compute({ visits: 1000, basket: 500, days: 31, gain: 100 }, FEE);
  assert.equal(s.baseline, 15_500_000); assert.equal(s.additional, 15_500_000);
  for (const v of Object.values(s)) assert.ok(v === null || Number.isFinite(v));
  assert.equal(compactEuro(s.scenario * 12), '372 Mio. €');
});

test('twelve-month series is linear, starts at zero and ends at twelve times the monthly figures', () => {
  const s = compute(EXAMPLE, FEE), pts = series(s);
  assert.equal(pts.length, 13); assert.deepEqual(pts[0], { month: 0, baseline: 0, scenario: 0, gap: 0 });
  assert.equal(pts[12].baseline, 109200); assert.equal(pts[12].scenario, 120120); assert.equal(pts[12].gap, 10920);
  assert.equal(pts[12].gap, pts[12].scenario - pts[12].baseline);
  const zero = series(compute(with_({ gain: 0 }), FEE)); assert.ok(zero.every(p => p.gap === 0 && p.baseline === p.scenario));
  const none = series(compute({ visits: 0, basket: 0, days: 0, gain: 0 }, FEE)); assert.ok(none.every(p => p.scenario === 0));
});

const ok = (key: FieldKey, text: string) => { const r = parseField(key, text); assert.equal(r.state, 'ok', `${key} "${text}"`); return (r as { value: number }).value; };
const bad = (key: FieldKey, text: string) => { const r = parseField(key, text); assert.equal(r.state, 'invalid', `${key} "${text}"`); return (r as { message: string }).message; };

test('input parsing: German commas, unambiguous points, blanks', () => {
  assert.equal(ok('basket', '7,50'), 7.5); assert.equal(ok('basket', '7.5'), 7.5); assert.equal(ok('basket', ' 7 € '), 7);
  assert.equal(ok('gain', '12,5'), 12.5); assert.equal(ok('visits', '50'), 50); assert.equal(ok('basket', '0,05'), 0.05);
  assert.equal(parseField('visits', '   ').state, 'empty'); assert.equal(parseField('days', '').state, 'empty');
  assert.equal(ok('basket', ',5'), 0.5);
});

test('input parsing rejects negatives, ambiguous separators, exponents and text', () => {
  assert.match(bad('visits', '-3'), /Negative/); bad('visits', '--3'); bad('visits', '+5');
  bad('basket', '1e5'); bad('visits', 'abc'); bad('basket', '7,5€x'); bad('basket', '1.234,56'); bad('basket', '1,234.56');
  bad('basket', '1.2.3'); bad('basket', '1,2,3'); bad('basket', '1.234'); bad('basket', ','); bad('basket', '.');
  bad('visits', '50,5'); bad('days', '2.5'); bad('basket', '7,555'); bad('gain', '10,55');
  assert.match(bad('visits', '1001'), /zwischen 0 und 1\.000/); assert.match(bad('days', '32'), /zwischen 0 und 31/);
  assert.match(bad('gain', '100,1'), /zwischen 0 und 100/); bad('basket', '500,01');
  assert.equal(ok('visits', '1000'), 1000); assert.equal(ok('gain', '100'), 100); assert.equal(ok('basket', '500'), 500);
  for (const key of Object.keys(LIMITS) as FieldKey[]) { assert.equal(ok(key, '0'), 0); }
});

test('formatting helpers', () => {
  assert.equal(formatNumber(-0), '0'); assert.equal(euro(-0.4), '0 €'); // never a minus before zero
  assert.equal(compactEuro(800), '800 €'); assert.equal(compactEuro(10452), '10 Tsd. €'); assert.equal(compactEuro(1200000), '1,2 Mio. €');
  assert.deepEqual(niceScale(0), { top: 1000, step: 250 });
  const n = niceScale(120120); assert.deepEqual(n, { top: 125000, step: 25000 });
  for (const m of [0.5, 37, 999, 4321, 15500000, 372000000]) { const q = niceScale(m); assert.ok(q.top >= m && q.top / q.step >= 3 && q.top / q.step <= 6.0001, String(m)); }
});
