import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homePage, legalPage } from '../template.js';
import { SITE } from '../src/site.js';

const home = homePage();
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const text = visible(home);
const section = (id: string, next: string) => visible(home.slice(home.indexOf(`id="${id}"`), home.indexOf(`id="${next}"`)));

test('the page follows the specified narrative order', () => {
  const ids = ['papier', 'ablauf', 'momente', 'rechner', 'plattform', 'start', 'preis', 'faq', 'anfrage'].map(id => home.indexOf(`id="${id}"`));
  assert.ok(ids.every(i => i > 0)); assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.match(text, /Ein guter Besuch\. Ein Grund, wiederzukommen\./);
});
test('price, support address, login and app origin are the approved ones; the price lives in one place', () => {
  assert.equal(SITE.price.amount, 39);
  assert.match(text, /39 € \/ Monat \/ Standort/); assert.match(text, /Pilotangebot – Details im persönlichen Gespräch/);
  assert.ok(home.includes('mailto:support@getloynara.com')); assert.ok(home.includes('href="https://app.getloynara.com/login"'));
  assert.doesNotMatch(home, /getlyonara/i);
  const src = ['../template.ts', '../src/views.ts', '../src/browser.ts', '../src/calc.ts', '../src/demo.ts'].map(f => readFileSync(resolve(import.meta.dirname, f), 'utf8')).join('\n');
  assert.ok(!/(?<![#\d,.])\b39\b(?![\d,.;])/.test(src), 'the fee is never hard-coded outside src/site.ts');
});
test('no stale price, internal wording or old brand', () => {
  assert.doesNotMatch(text, /\b49\s*€|€\s*49|\b69\s*€|\b99\s*€|\b397\b|Einrichtungsgebühr|Rabatt|Jahresrabatt|nur noch|begrenzt/i);
  assert.doesNotMatch(text, /LoopLocal|synthetic|synthetisch|Audit|Entwurf|nicht geprüft|nicht getestet|in Vorbereitung|Testdaten|lokal getestet/i);
});
test('no fabricated proof, outcomes or unsupported availability claims', () => {
  assert.doesNotMatch(text, /Testimonial|Referenz(?:kunden)?\b|bereits im Einsatz|vertrauen uns|\d[\d.]* (?:zufriedene )?Kunden nutzen|garantiert|Garantie auf|mehr Umsatz um|ROI\b|Rendite von|Gewinn von|spart? Zeit/i);
  assert.doesNotMatch(text, /iPhone|Android|alle Handys|jedes Smartphone|Apple Pay|Google Pay|Smart Tap|Apple VAS|automatische Vergabe|Bezahlen per NFC/i);
  assert.doesNotMatch(home, /<img[^>]+(?:logo-wall|partner|kunden-logo)/i);
});
test('platform previews are marked as previews and kept out of the offer', () => {
  const pricing = section('preis', 'faq');
  assert.match(pricing, /Im aktuellen Pilotangebot/); assert.match(pricing, /Plattform-Ausblick – nicht Teil des Angebots/);
  const inOffer = pricing.slice(pricing.indexOf('Im aktuellen Pilotangebot'), pricing.indexOf('Plattform-Ausblick'));
  assert.doesNotMatch(inOffer, /Kampagn|Nachricht|Automat|Wallet/);
  assert.match(section('momente', 'rechner'), /Plattform-Vorschau/); assert.match(section('plattform', 'start'), /nicht Teil des aktuellen Angebots/);
  assert.doesNotMatch(text, /Jetzt senden|Nachricht senden|Kampagne starten/);
});
test('calculator copy: scope, disclaimer next to the result, no profit/ROI wording', () => {
  const calc = section('rechner', 'plattform');
  assert.match(calc, /Für einen Standort/); assert.match(calc, /Rechenbeispiel, keine Umsatzprognose\. Wareneinsatz, Prämien, zusätzliche Arbeitskosten und Steuern sind nicht berücksichtigt\./);
  assert.match(calc, /910 € zusätzlicher Monatsumsatz im Beispiel/); assert.match(calc, /871 €/); assert.match(calc, /10\.452 €/); assert.match(calc, /23,3×/);
  assert.match(calc, /Differenz nach Abogebühr/); assert.match(calc, /Umsatz-\/Gebührenverhältnis/);
  assert.doesNotMatch(calc, /Nettogewinn|Netto-Nutzen|Return on|Ihr Geld|verdienst du/i);
  const i = calc.indexOf('zusätzlicher Monatsumsatz im Beispiel'), j = calc.indexOf('Rechenbeispiel, keine Umsatzprognose');
  assert.ok(j > i && j - i < 120, 'disclaimer directly follows the primary result');
});
test('the contact section states the honest mail-draft behaviour', () => {
  assert.match(text, /Deine Anfrage wird in deinem E-Mail-Programm geöffnet\. Gesendet wird sie erst dort\./);
  assert.match(text, /E-Mail vorbereiten/); assert.doesNotMatch(text, /Anfrage gesendet|erfolgreich übermittelt|Vielen Dank für deine Anfrage/);
});
test('metadata is complete and indexable on the home page', () => {
  assert.match(home, /<title>Loynara – /);
  for (const marker of ['name="description"', 'rel="canonical" href="https://getloynara.com/"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"', 'rel="icon"', 'name="robots" content="index,follow"']) assert.ok(home.includes(marker), marker);
  assert.equal((home.match(/<h1[ >]/g) ?? []).length, 1);
});
test('publication changes survive: legal links, no terms link, legal fragments rendered, placeholders noindex', () => {
  for (const href of ['/impressum/', '/datenschutz/']) assert.ok(home.includes(`href="${href}"`), href);
  assert.doesNotMatch(home, /Teilnahmebedingungen|teilnahmebedingungen/);
  assert.match(legalPage('impressum', { impressum: null, datenschutz: null }), /noindex,nofollow/);
  assert.match(legalPage('impressum', { impressum: '<p>Beispiel</p>', datenschutz: null }), /index,follow/);
  const real = readFileSync(resolve(import.meta.dirname, '../legal/impressum.html'), 'utf8');
  assert.match(real, /Kassel/); assert.match(legalPage('impressum', { impressum: real, datenschutz: null }), /Friedrich-Ebert-Straße 70/);
});
