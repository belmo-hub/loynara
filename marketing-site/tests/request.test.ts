import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from '../src/request.js';
import { SITE } from '../src/site.js';

const base = { business: 'Café Beispiel', industry: 'Café', message: '' };
test('the request becomes a mailto to the support address and is refused without a business name', () => {
  assert.equal(buildRequest({ ...base, business: '   ' }), null);
  const r = buildRequest(base)!;
  assert.ok(r.mailto.startsWith(`mailto:${SITE.supportEmail}?subject=`)); assert.equal(SITE.supportEmail, 'support@getloynara.com');
  assert.match(decodeURIComponent(r.mailto), /Geschäft: Café Beispiel/); assert.match(r.body, /Bitte meldet euch für einen Demo-Termin\./);
});
test('umlauts, line breaks and special characters survive URI encoding', () => {
  const r = buildRequest({ business: 'Bäckerei & Café "Süß" 50%', industry: 'Café', message: 'Zeile 1\r\nZeile 2 – ?x=1&y=2 #tag' })!;
  const decoded = decodeURIComponent(r.mailto.split('body=')[1]);
  assert.ok(decoded.includes('Bäckerei & Café "Süß" 50%')); assert.ok(decoded.includes('Zeile 1\nZeile 2 – ?x=1&y=2 #tag'));
  assert.ok(!/[&#]/.test(r.mailto.split('?')[1].replace(/&body=/, '').replace(/^subject=/, '')));
});
test('header injection through line breaks in single-line fields is impossible', () => {
  const r = buildRequest({ ...base, business: 'Shop\r\nBcc: someone@example.test', industry: 'x\ny' })!;
  assert.equal(r.subject.includes('\n'), false); assert.ok(!r.mailto.includes('%0ABcc')); assert.ok(!r.mailto.includes('%0D'));
});
test('calculator figures are attached only when explicitly provided', () => {
  assert.doesNotMatch(buildRequest(base)!.body, /Rechenbeispiel/);
  const r = buildRequest({ ...base, figures: 'Käufe pro Tag: 50' })!;
  assert.match(r.body, /Rechenbeispiel-Zahlen \(Szenario, keine Prognose\)/); assert.match(r.body, /Käufe pro Tag: 50/);
});
