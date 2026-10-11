import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { angles, sources, CLASSES, STATUSES, USES, render } from '../../gtm/data/angles.mjs';

type Angle = Record<string, string>;
const A = angles as Angle[], S = sources as Angle[];
const OUTWARD = ['walk-in', 'static-ad', 'video', 'homepage', 'retargeting', 'vertical-page', 'content'];

test('every original angle 1–124 is traceable to exactly one canonical angle with the same status', () => {
  const ids = S.filter(s => /^O\d+$/.test(s.source_id)).map(s => Number(s.source_id.slice(1)));
  assert.deepEqual([...ids].sort((a, b) => a - b), Array.from({ length: 124 }, (_, i) => i + 1));
  for (const s of S) {
    const a = A.find(x => x.id === s.merged_into);
    assert.ok(a, `${s.source_id} → ${s.merged_into}`);
    assert.equal(s.status, a.status, s.source_id);
    assert.ok(a.sources.split(';').includes(s.source_id), `${a.id} lists ${s.source_id}`);
    assert.ok(['represented', 'partial', 'missing'].includes(s.coverage_before), s.source_id);
  }
});

test('canonical angles: unique, classified, evidence-stated, complete and used somewhere', () => {
  assert.equal(new Set(A.map(a => a.id)).size, A.length);
  for (const a of A) {
    assert.ok((CLASSES as string[]).includes(a.class), `${a.id} class`);
    assert.ok(Object.keys(STATUSES).includes(a.status), `${a.id} status`);
    for (const k of ['name', 'pain', 'outcome', 'hook', 'verticals', 'channel', 'proof', 'objection', 'cta', 'use']) assert.ok(a[k], `${a.id} ${k}`);
    assert.ok(a.sources || a.previous, `${a.id} has a source`);
    const uses = a.use.split(';');
    assert.ok(uses.length > 0 && uses.every(u => u in USES), `${a.id} uses ${a.use}`);
    if (a.status !== 'SELL NOW') assert.ok(a.qualifier, `${a.id} needs its boundary sentence`);
    if (a.class === 'FUTURE') assert.equal(a.status, 'FUTURE', a.id);
  }
  assert.ok(A.filter(a => a.class === 'CORE').length >= 8 && A.filter(a => a.class === 'CORE').length <= 12, '8–12 core angles');
});

test('claim safety: outward placements carry only what the evidence state allows', () => {
  for (const a of A) {
    const uses = a.use.split(';');
    if (a.status === 'FUTURE') assert.ok(uses.every(u => u === 'learning-log' || u === 'outlook'), `${a.id} FUTURE is not used outward`);
    if (a.status === 'RC READY') assert.ok(!uses.some(u => ['static-ad', 'video', 'homepage', 'retargeting', 'content'].includes(u)), `${a.id} RC READY stays in demo/FAQ/onboarding`);
    if (a.status === 'SELL NOW') {
      assert.doesNotMatch(a.hook, /NFC|Wallet|[Aa]ntipp|Nachricht|automatisch|Kartennummer|neu ausstell|Logo|KI\b/, `${a.id} hook`);
      assert.ok(!uses.includes('outlook'), a.id);
    }
    if (uses.some(u => OUTWARD.includes(u))) assert.doesNotMatch(`${a.hook} ${a.outcome}`, /garantiert|mehr Umsatz|\d+\s?%|verdoppel|nur noch|gratis|kostenlos/i, `${a.id} outward copy`);
  }
  const nfc = A.find(a => a.id === 'CORE-11')!;
  assert.equal(nfc.status, 'QUALIFIED');
  assert.match(nfc.hook, /vorbereitet/);
});

test('owner-view angles never promise names: the live customer list is pseudonymous', () => {
  for (const a of A.filter(x => x.status !== 'FUTURE')) assert.doesNotMatch(`${a.hook} ${a.outcome}`, /\bwer (?:fehlt|seit)|Name, letzter|mit Namen/i, a.id);
  for (const id of ['CORE-08', 'RET-01']) assert.match(A.find(a => a.id === id)!.qualifier, /pseudonym/i, id);
});

test('generated angle documents are up to date with the CSVs', () => {
  for (const [path, text] of render() as Array<[string, string]>) assert.equal(readFileSync(path, 'utf8'), text, `${path} is stale: run node gtm/data/angles.mjs`);
});

test('the reconciliation document counts exactly the 124 originals', () => {
  const doc = readFileSync(new URL('../../gtm/14-angle-reconciliation.md', import.meta.url), 'utf8');
  const n = (label: string) => Number(new RegExp(`\\| ${label} \\| (\\d+) \\|`).exec(doc)![1]);
  assert.equal(n('Already represented') + n('Partially represented') + n('Missing'), 124);
  assert.equal(n('SELL NOW') + n('RC READY — not deployed') + n('QUALIFIED / PREVIEW') + n('FUTURE / DO NOT SELL YET'), 124);
  const appendix = doc.slice(doc.indexOf('## Appendix A'), doc.indexOf('## Other sections'));
  assert.equal((appendix.match(/^\| \d+ \|/gm) ?? []).length, 124);
});
