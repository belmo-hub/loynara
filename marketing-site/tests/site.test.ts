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

test('the page has exactly seven main scenes in the specified order and carries the central idea and headline', () => {
  const ids = ['hero', 'ablauf', 'inhaber', 'gestaltung', 'rechner', 'angebot', 'anfrage'].map(id => home.indexOf(`id="${id}"`));
  assert.ok(ids.every(i => i > 0)); assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.equal((home.match(/<section class="(?:hero|section )/g) ?? []).length, 7, 'seven scenes; header and footer are not scenes');
  assert.match(text, /Ein guter Besuch\. Ein Grund, wiederzukommen\./); assert.match(text, /Wiederkommen belohnen\. Weiterempfehlen leicht machen\./);
  assert.match(text, /Digitale Treuekarten, Prämien und Empfehlungen – verbunden in einem System für dein Geschäft\./);
  assert.match(text, /Kunden öffnen ihre Karte\. Dein Team bestätigt\. Du siehst, was passiert\./);
  assert.match(text, /Nicht nur Stempel sammeln\. Den nächsten Besuch mitdenken\./);
  for (const h of ['Aus einem Besuch wird eine Beziehung.', 'Nicht nur sehen, wer kommt. Einen Anlass zum Wiederkommen schaffen.', 'Dein Geschäft. Wiedererkennbar bis zur nächsten Prämie.', 'Was würde ein zusätzlicher Anlass zum Wiederkommen bedeuten?', 'Ein System für den Tresen, dein Team und deine Kunden.', 'Gib dem nächsten Besuch einen Grund. Und der nächsten Empfehlung einen Weg.', 'Wir zeigen dir Loynara am Beispiel deines Geschäfts.']) assert.ok(text.includes(h), h);
});
test('zero-click test: the default page states staff confirmation, rewards, referrals, owner visibility, branding, the counter touchpoint, price and CTA', () => {
  for (const re of [/Dein Team bestätigt jeden Besuch/, /Voller Stand, Prämie, Einlösung/, /Freund bringt Freund/, /Empfehlung/, /Überblick/, /Markenstil/, /Aufsteller|Tresen/, /39 € \/ Monat \/ Standort/, /Demo anfragen/, /Plattform-Ausblick/]) assert.match(text, re, String(re));
  assert.match(visible(home.slice(home.indexOf('id="ablauf"'), home.indexOf('id="inhaber"'))), /Besuch → Fortschritt → Prämie → Empfehlung → neuer Besuch|Besuch\s+Fortschritt\s+Prämie\s+Empfehlung\s+neuer Besuch/);
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
  assert.doesNotMatch(text, /Testimonial|Referenz(?:kunden)?\b|bereits im Einsatz|vertrauen uns|\d[\d.]* (?:zufriedene )?Kunden nutzen|\bgarantiert\b|Garantie auf|mehr Umsatz um|ROI\b|Rendite von|Gewinn von|spart? Zeit/i);
  assert.doesNotMatch(text, /iPhone|Android|alle Handys|jedes Smartphone|Apple Pay|Google Pay|Smart Tap|Apple VAS|automatische Vergabe|Bezahlen per NFC/i);
  assert.doesNotMatch(home, /<img[^>]+(?:logo-wall|partner|kunden-logo)/i);
});
test('platform previews are marked as previews and kept out of the offer, near the point of demonstration', () => {
  const pricing = section('angebot', 'anfrage');
  assert.match(pricing, /Aktuelles Pilotangebot/); assert.match(pricing, /Gezeigter Ausblick · gesondert zu vereinbaren/i);
  const inOffer = pricing.slice(pricing.indexOf('Aktuelles Pilotangebot'), pricing.toLowerCase().indexOf('gezeigter ausblick'));
  assert.doesNotMatch(inOffer, /Kampagn|Nachricht|Automat|Wallet|Aufsteller|Logo-Darstellung/);
  const outlook = pricing.slice(pricing.toLowerCase().indexOf('gezeigter ausblick'));
  for (const w of ['Aufsteller', 'Wallet-Karte', 'Logo-Darstellung', 'Kampagnen']) assert.ok(outlook.includes(w), w);
  assert.match(section('inhaber', 'gestaltung'), /Ausblick/); assert.match(section('gestaltung', 'rechner'), /Gestaltungsbeispiel/); assert.match(section('gestaltung', 'rechner'), /Ausblick/);
  assert.doesNotMatch(text, /Jetzt senden|Nachricht senden|Kampagne starten|Zu Wallet hinzufügen|Add to Wallet/);
});
test('calculator copy: scope, disclaimer next to the result, no profit/ROI wording', () => {
  const calc = section('rechner', 'angebot');
  assert.match(calc, /Für einen Standort/); assert.match(calc, /Deine Zahlen\. Deine Annahme\. Ein nachvollziehbares Rechenbeispiel\./); assert.match(calc, /Rechenbeispiel, keine Umsatzprognose\. Wareneinsatz, Prämien, zusätzliche Arbeitskosten und Steuern sind nicht berücksichtigt\./);
  assert.match(calc, /910 € zusätzlicher Monatsumsatz im Beispiel/); assert.match(calc, /871 €/); assert.match(calc, /10\.452 €/); assert.match(calc, /23,3×/);
  assert.match(calc, /Nach Abzug der Gebühr \( ?39 € \/ Monat ?\): \+871 € im Monat, 10\.452 € auf zwölf Monate hochgerechnet/);
  // finding 16: primary ratio removed; preserved in the expanded calculation details, labelled as a comparison
  const primary = calc.slice(calc.indexOf('zusätzlicher Monatsumsatz im Beispiel'), calc.indexOf('Berechnung und Annahmen im Detail'));
  assert.doesNotMatch(primary, /23,3×|Verhältnis/); const detailsStart = home.indexOf('<details class="calc-assumptions">'); assert.ok(detailsStart > 0 && home.indexOf('23,3×') > detailsStart, 'ratio appears only inside the expanded details');
  assert.match(visible(home.slice(home.indexOf('<details class="calc-assumptions">'), home.indexOf('id="calc-empty"'))), /Zusatzumsatz im Vergleich zur Monatsgebühr 23,3× .*kein Gewinn und keine garantierte Rendite/);
  assert.doesNotMatch(calc, /Nettogewinn|Netto-Nutzen|Return on|Ihr Geld|verdienst du/i);
  const i = calc.indexOf('zusätzlicher Monatsumsatz im Beispiel'), j = calc.indexOf('Rechenbeispiel, keine Umsatzprognose'), k = calc.indexOf('Berechnung und Annahmen im Detail');
  assert.ok(j > i && j - i < 120, 'disclaimer directly follows the primary result'); assert.ok(k > j && k - j < 260, 'details follow the disclaimer');
});
test('review corrections: demo stage has no scroll-driven guide or mobile Zurück/Weiter, hero is labelled as an illustration', () => {
  assert.doesNotMatch(home, /guide-prev|guide-next|guide-nav|Interaktive Demo · Beispieldaten/);
  assert.match(home, /Beispieldarstellung/); assert.match(home, /class="reset-button"/);
  assert.equal((home.match(/data-reveal/g) ?? []).length <= 3, true, 'fade-up reveals are reserved for product visuals');
  assert.doesNotMatch(home, /pgroup|class="tags"|pvisual/);
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

test('robustness CSS: solid header fallback, prefixed blur, print shows all reveals and drops sticky positioning', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../styles.css'), 'utf8');
  assert.match(css, /\.header\{position:sticky;[^}]*background:var\(--canvas\)/);
  assert.match(css, /@supports \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{\.header\{background:rgba\(246,243,236,\.9\);-webkit-backdrop-filter:[^}]*backdrop-filter:/);
  assert.match(css, /@media print\{\[data-reveal\]\{opacity:1!important;transform:none!important\}\.header,\.stage-col,\.stage\{position:static!important\}/);
  assert.doesNotMatch(css, /color-mix\(/, 'no color-mix: older Safari versions would drop the header background');
});
