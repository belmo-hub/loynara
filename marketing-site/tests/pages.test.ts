import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { subPage, homePage } from '../template.js';
import { SUB_PAGES, barber, pizzeria, referrals, visitsToCoverFee } from '../src/pages.js';
import { SITE } from '../src/site.js';

const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const pages = SUB_PAGES.map(p => ({ p, html: subPage(p), text: visible(subPage(p)) }));

test('each supporting page has its own path, one h1, indexable metadata and the shared chrome', () => {
  assert.deepEqual(SUB_PAGES.map(p => p.path), ['/fuer-barber/', '/fuer-pizzerien/', '/empfehlungen/']);
  for (const { p, html } of pages) {
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, p.path);
    assert.ok(html.includes(`rel="canonical" href="https://getloynara.com${p.path}"`), p.path);
    assert.match(html, /name="robots" content="index,follow"/);
    assert.ok(p.title.length <= 70 && p.description.length >= 80 && p.description.length <= 170, `${p.path} title/description length`);
    assert.match(html, /<a class="login" href="https:\/\/app\.getloynara\.com\/login">Anmelden<\/a>/);
    assert.match(html, /href="\/impressum\/"/); assert.match(html, /href="\/datenschutz\/"/);
    for (const id of ['hero', 'ablauf', 'fragen', 'anfrage']) assert.ok(html.includes(`id="${id}"`), `${p.path} #${id}`);
    assert.ok(html.includes(`mailto:${SITE.supportEmail}?subject=`), `${p.path} contact`);
  }
});

test('internal linking: the footer reaches every supporting page; vertical pages link to the referral page and the calculator', () => {
  for (const html of [homePage(), ...pages.map(x => x.html)]) for (const p of SUB_PAGES) assert.ok(html.includes(`href="${p.path}"`), p.path);
  for (const p of [barber, pizzeria]) { const html = subPage(p); assert.ok(html.includes('href="/empfehlungen/"')); assert.ok(html.includes('href="/#rechner"')); }
  assert.ok(subPage(referrals).includes('href="/fuer-barber/"') && subPage(referrals).includes('href="/fuer-pizzerien/"'));
});

test('price comes from the single source and the break-even line is plain arithmetic', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../src/pages.ts'), 'utf8');
  assert.ok(!/(?<![#\d,.])\b39\b(?![\d,.;])/.test(src), 'the fee is never hard-coded in pages.ts');
  assert.equal(visitsToCoverFee(25), Math.ceil(SITE.price.amount / 25));
  assert.match(visible(subPage(barber)), new RegExp(`Bei rund 25 € pro Haarschnitt entspricht das etwa ${visitsToCoverFee(25)} zusätzlichen Besuchen im Monat\\.`));
  assert.match(visible(subPage(pizzeria)), new RegExp(`Bei rund 18 € pro Bestellung entspricht das etwa ${visitsToCoverFee(18)} zusätzlichen Besuchen im Monat\\.`));
  for (const { p, text } of pages) {
    assert.match(text, new RegExp(`${SITE.price.amount} € / Monat / Standort`), p.path);
    if (p !== referrals) assert.match(text, /Rechenbeispiel, keine Prognose\. Wareneinsatz, Prämien und Arbeitszeit sind nicht berücksichtigt\./, p.path);
  }
});

test('claim safety: QR today; NFC, Wallet and messages only as outlook; no proof, results or availability the product cannot show', () => {
  for (const { p, text } of pages) {
    const hero = visible(subPage(p).slice(subPage(p).indexOf('id="hero"'), subPage(p).indexOf('</section>')));
    assert.doesNotMatch(hero, /NFC|Wallet|antippen/i, `${p.path} hero`);
    for (const m of text.match(/[^.?]*(?:NFC|Wallet)[^.?]*[.?]/g) ?? []) assert.match(m, /Ausblick|\?$/, `${p.path}: ${m}`);
    for (const m of text.match(/[^.]*(?:Nachrichten|Aktionen)[^.]*\./g) ?? []) assert.match(m, /Ausblick|nicht Teil/, `${p.path}: ${m}`);
    assert.doesNotMatch(text, /Testimonial|Referenzkunde|bereits im Einsatz|vertrauen uns|zufriedene Kunden|\bgarantiert\b|Garantie|mehr Umsatz|Umsatzplus|ROI\b|Rendite|\d+\s?% mehr|verdoppel/i, p.path);
    assert.doesNotMatch(text, /Zu Wallet hinzufügen|Add to Wallet|Apple Pay|Google Pay|Kampagne starten|Nachricht senden|automatisch (?:verschickt|gesendet)|Kassenanbindung inklusive/i, p.path);
    assert.doesNotMatch(text, /kostenlos|gratis testen|Testphase|Probemonat|nur noch|begrenzt|Einrichtungsgebühr|Rabatt/i, p.path);
    assert.doesNotMatch(text, /LoopLocal|synthetisch|synthetic|Testdaten|in Vorbereitung/i, p.path);
    assert.match(text, /Beispieldaten/, `${p.path}: example data is labelled`);
  }
});

test('truthful product boundaries the merchant needs to hear', () => {
  assert.match(visible(subPage(pizzeria)), /Bestellungen über Lieferplattformen laufen nicht über Loynara\./);
  assert.match(visible(subPage(pizzeria)), /Eine Anbindung an Lieferplattformen oder die Kasse gibt es nicht\./);
  for (const p of [barber, pizzeria]) assert.match(visible(subPage(p)), /Gezählt wird nur, was dein Team bestätigt hat – nicht dein gesamter Umsatz\./);
  const r = visible(subPage(referrals));
  assert.match(r, /Kein Bonus für bloßes Teilen, Öffnen oder Anmelden\./);
  assert.match(r, /Der Bonus wird genau einmal gebucht, nach dem ersten bestätigten Besuch\./);
  assert.match(r, /lässt sich nicht vollständig beweisen/);
  assert.match(r, /Ob jemand auch ohne Empfehlung gekommen wäre, kann niemand wissen\./);
  assert.doesNotMatch(r, /pro Monat (?:höchstens|maximal)|Monatslimit|Obergrenze/, 'no referral cap is claimed (not built)');
});

test('accessible structure: example pictures are labelled, FAQ uses native disclosures, no script is required', () => {
  for (const { p, html } of pages) {
    assert.match(html, /<figure class="hero-scene hero-scene-sub" aria-label="Beispieldarstellung">/, p.path);
    assert.doesNotMatch(html, /<script/, `${p.path} is static`);
    assert.equal((html.match(/<details><summary>/g) ?? []).length, p.faq.length, p.path);
    for (const [, alt] of html.matchAll(/role="img" aria-label="([^"]*)"/g)) assert.ok(alt.length > 10, `${p.path}: ${alt}`);
  }
});

test('owner views are pseudonymous like the real customer list: no named customers, no named-list claim', () => {
  for (const html of [homePage(), ...pages.map(x => x.html)]) {
    for (const [, list] of html.matchAll(/<ul class="people">([\s\S]*?)<\/ul>/g)) for (const [, name] of list.matchAll(/<b>([^<]*)<\/b>/g)) assert.match(name, /^Karte [A-Z]$/, name);
    assert.doesNotMatch(visible(html), /Name, letzter|Namen und Telefonnummern|wer seit Wochen fehlt|wer schon länger fehlt|wann es ruhig ist/);
  }
  for (const { text } of pages.filter(x => x.p !== referrals)) assert.match(text, /Namen zeigt Loynara nicht/);
});
