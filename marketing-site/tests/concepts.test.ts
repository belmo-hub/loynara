import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conceptA, conceptB, conceptC, conceptIndex } from '../concepts/pages.js';
import { SITE } from '../src/site.js';
import { cardHtml, statusFor } from '../src/concept-parts.js';

const pages = { a: conceptA(), b: conceptB(), c: conceptC(), index: conceptIndex() };
const text = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('concept prototypes are private review pages: noindex, no inline script or style', () => {
  for (const [k, h] of Object.entries(pages)) {
    assert.match(h, /<meta name="robots" content="noindex,nofollow">/, k);
    assert.doesNotMatch(h, /\sstyle="|<style|<script>(?!<\/script>)/, k);
  }
});
test('each concept carries the same commercial facts from the single price source', () => {
  for (const k of ['a', 'b', 'c'] as const) {
    const t = text(pages[k]);
    assert.ok(t.includes(`${SITE.price.amount} €`), `${k}: price`);
    assert.match(t, /Für die ersten Betriebe gibt es einen Gründungspreis – im persönlichen Gespräch\./, k);
    assert.match(t, /Gezeigter Ausblick,? ?·? ?gesondert zu vereinbaren/i, k);
    assert.match(t, /910 €/, k); assert.match(t, /\+861 €/, k); assert.match(t, /\+10\.332 €/, k);
    assert.match(t, /Rechenbeispiel, keine Umsatzprognose\./, k);
    assert.match(t, /Plattform-Ausblick – nicht im aktuellen Pilotangebot/, k);
    assert.match(t, /Gestaltungsbeispiel/, k); assert.match(t, /Wallet-Vorschau/, k);
    assert.match(t, /Vorschau · nicht versendet/i, k);
    assert.ok(pages[k].includes(`mailto:${SITE.supportEmail}`), `${k}: contact`);
    assert.doesNotMatch(t, /Add to Wallet|Zu Wallet hinzufügen|Jetzt senden|Nettogewinn|garantiert|kostenlos|Testphase/i, k);
  }
});
test('referral copy never rewards sharing or opening', () => {
  for (const k of ['a', 'b', 'c'] as const) assert.match(text(pages[k]), /(Teilen|Teilen oder Öffnen) allein bringt (noch )?keinen Bonus|nicht (mit )?dem Teilen|nicht das Teilen/, k);
});
test('the card primitive derives its label from the balance', () => {
  assert.match(cardHtml({ balance: 9, status: statusFor(9) }), /9 von 10 Stempeln\. Noch ein Besuch/);
  assert.equal(statusFor(10), 'Prämie bereit'); assert.equal(statusFor(0, true), 'Prämie eingelöst');
  assert.equal((cardHtml({ balance: 3, status: '' }).match(/<li class="on">/g) ?? []).length, 3);
});
