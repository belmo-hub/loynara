import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from '../src/request.js';
import { SITE } from '../src/site.js';

const base = { business: 'Café Beispiel', industry: 'Café', locations: '2', name: '', phone: '', message: '' };
test('the request becomes a mailto to the support address and is refused without a business name', () => {
  assert.equal(buildRequest({ ...base, business: '   ' }), null);
  const r = buildRequest(base)!;
  assert.ok(r.mailto.startsWith(`mailto:${SITE.supportEmail}?subject=`));
  assert.equal(SITE.supportEmail, 'support@getloynara.com');
  assert.match(decodeURIComponent(r.mailto), /Geschäft: Café Beispiel/);
  assert.match(r.body, /Bitte meldet euch für einen Demo-Termin\./);
});
test('header injection through line breaks in single-line fields is impossible', () => {
  const r = buildRequest({ ...base, business: 'Shop\r\nBcc: someone@example.test', name: 'A\nB' })!;
  assert.ok(!/\r|\n.*Bcc:/.test(r.subject));
  assert.equal(r.subject.includes('\n'), false);
  assert.ok(!r.mailto.includes('%0ABcc'));
});
