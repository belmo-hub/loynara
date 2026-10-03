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
/** The page as a visitor sees it before touching anything: tab panels that are `hidden` do not count. */
const defaultVisible = visible(home.replace(/<div class="(?:stage-view|ow)"[^>]*\shidden[^>]*>[\s\S]*?(?=<div class="(?:stage-view|ow)"|<\/div><p class="sr-only" data-live|<\/div><\/div><\/section>)/g, ' '));

test('the page has the final scene order with exactly one h1 and the approved headline', () => {
  const ids = ['hero', 'ablauf', 'empfehlung', 'inhaber', 'gestaltung', 'rechner', 'angebot', 'anfrage'].map(id => home.indexOf(`id="${id}"`));
  assert.ok(ids.every(i => i > 0)); assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.equal((home.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(text, /Ein guter Besuch\. Ein Grund, wiederzukommen\./);
  assert.match(section('hero', 'ablauf'), /Digitale Kundenbindung für dein Geschäft: Kunden sammeln Prämien ohne App, dein Team bestätigt jeden Besuch und Empfehlungen bekommen einen klaren Ablauf\./);
  for (const h of ['Aus einem Besuch wird eine Beziehung.', 'Belohne nicht nur den Besuch. Auch die Empfehlung.', 'Nicht nur sehen, wer kommt. Einen Anlass schaffen.', 'Dein Geschäft. Wiedererkennbar bis zur nächsten Prämie.', 'Was würde dieses Szenario für dein Geschäft bedeuten?', 'Ein System für den Tresen, dein Team und deine Kunden.', 'Gib dem nächsten Besuch einen Grund. Und der nächsten Empfehlung einen Weg.']) assert.ok(text.includes(h), h);
});
test('hero: CTA hierarchy, quiet login, smooth anchor to the contact section', () => {
  const hero = home.slice(home.indexOf('id="hero"'), home.indexOf('id="ablauf"'));
  assert.match(hero, /<a class="btn btn-primary" href="#anfrage">Demo anfragen<\/a><a class="btn btn-ghost" href="#ablauf">Ablauf ansehen<\/a>/);
  assert.match(home, /<a class="login" href="https:\/\/app\.getloynara\.com\/login">Anmelden<\/a>/);
  assert.ok(home.includes('id="anfrage"'));
});
test('zero interaction: every key benefit is visible without selecting a tab', () => {
  // the always-visible summary above the product stage
  const summary = section('ablauf', 'stage"');
  for (const re of [/Besuche belohnen/, /Empfehlungen fördern/, /Kundenaktivität verstehen/, /Aus Stammkunden können Empfehlungen werden/, /Kunde öffnet Karte[\s\S]*Team bestätigt[\s\S]*Fortschritt wächst[\s\S]*Empfehlung kann folgen/]) assert.match(summary, re, String(re));
  for (const re of [/ohne App/, /Team bestätigt jeden Besuch/, /Prämien/, /Empfehlungen/, /Sieh, was passiert\. Erkenne ruhige Zeiten\. Hol Stammkunden zurück\./, /Überblick/, /Aufsteller/, /Gestaltungsbeispiel/, /39 € \/ Monat \/ Standort/, /Demo anfragen/, /Gezeigter Ausblick/, /Wallet-Vorschau/, /Plattform-Ausblick|Teil des Pilotangebots/])
    assert.match(defaultVisible, re, String(re));
  // referral value is also visible on its own, not only inside the stage tab
  assert.match(section('empfehlung', 'inhaber'), /Geteilt[\s\S]*Teilnahme offen[\s\S]*Bedingung erfüllt[\s\S]*Bonus verbucht/);
  assert.match(section('empfehlung', 'inhaber'), /Teilen, Öffnen oder bloßes Anmelden bringt keinen Bonus/);
});
test('tab modules: three real tablists, roving tabindex, one tabpanel each, first view visible', () => {
  assert.equal((home.match(/role="tablist"/g) ?? []).length, 3);
  assert.equal((home.match(/role="tab"/g) ?? []).length, 8);
  assert.equal((home.match(/role="tabpanel"/g) ?? []).length, 3);
  assert.equal((home.match(/tabindex="0"/g) ?? []).length >= 3, true);
  assert.equal((home.match(/aria-selected="true"/g) ?? []).length, 3);
});
test('price, support address, login and app origin are the approved ones; the price lives in one place', () => {
  assert.equal(SITE.price.amount, 39); assert.equal(SITE.supportEmail, 'support@getloynara.com'); assert.equal(SITE.loginUrl, 'https://app.getloynara.com/login');
  assert.match(text, /39 € \/ Monat \/ Standort/); assert.match(text, /Pilotangebot – Details im persönlichen Gespräch/);
  assert.ok(home.includes('mailto:support@getloynara.com')); assert.ok(home.includes('href="https://app.getloynara.com/login"'));
  assert.doesNotMatch(home, /getlyonara/i);
  const src = ['../template.ts', '../src/final-parts.ts', '../src/final.ts', '../src/calc.ts', '../src/demo.ts', '../src/ref.ts'].map(f => readFileSync(resolve(import.meta.dirname, f), 'utf8')).join('\n');
  assert.ok(!/(?<![#\d,.])\b39\b(?![\d,.;])/.test(src), 'the fee is never hard-coded outside src/site.ts');
});
test('no stale price, internal wording or old brand', () => {
  assert.doesNotMatch(text, /\b49\s*€|€\s*49|\b69\s*€|\b99\s*€|\b397\b|Einrichtungsgebühr|Rabatt|Jahresrabatt|nur noch|begrenzt|kostenlos|Testphase|Probemonat|Kündigung|zzgl\.|inkl\./i);
  assert.doesNotMatch(text, /LoopLocal|synthetic|synthetisch|Audit|Entwurf|nicht geprüft|nicht getestet|in Vorbereitung|Testdaten|lokal getestet/i);
});
test('no fabricated proof, misleading referral economics or unsupported availability claims', () => {
  assert.doesNotMatch(text, /Testimonial|Referenz(?:kunden)?\b|bereits im Einsatz|vertrauen uns|\d[\d.]* (?:zufriedene )?Kunden nutzen|\bgarantiert\b|Garantie auf|mehr Umsatz um|ROI\b|Rendite von|Gewinn von|spart? Zeit/i);
  assert.doesNotMatch(text, /Kundengewinnung für 0|kostenlose Neukunden|Neukunden gratis|Akquise(?:kosten)? von|pro Neukunde|Cost per|mehr Neukunden/i);
  assert.doesNotMatch(text, /iPhone|Android|alle Handys|jedes Smartphone|Apple Pay|Google Pay|Smart Tap|Apple VAS|automatische Vergabe|Bezahlen per NFC|Zu Wallet hinzufügen|Add to Wallet/i);
  assert.doesNotMatch(text, /[Zz]ertifiziert|Acryl|Lieferzeit|Lieferung|Material|\d+\s?(?:cm|mm)\b|im Preis (?:enthalten|inbegriffen)/);
  assert.doesNotMatch(home, /<img[^>]+(?:logo-wall|partner|kunden-logo)/i);
});
test('platform previews are marked as outlook and kept out of the offer, near the point of demonstration', () => {
  const owner = section('inhaber', 'gestaltung');
  assert.equal((owner.match(/Plattform-Ausblick – nicht im aktuellen Pilotangebot/g) ?? []).length, 2);
  assert.equal((owner.match(/Vorschau · nicht versendet/g) ?? []).length, 2);
  assert.match(owner, /Teil des Pilotangebots/);
  const offer = section('angebot', 'anfrage');
  const current = offer.slice(offer.indexOf('Aktuell enthalten'), offer.indexOf('Gezeigter Ausblick'));
  assert.doesNotMatch(current, /Kampagn|Nachricht|Wallet|Aufsteller|Logo-Darstellung/);
  const outlook = offer.slice(offer.indexOf('Gezeigter Ausblick'));
  for (const w of ['Aufsteller', 'Wallet-Karte', 'Logo-Darstellung', 'Kampagnen']) assert.ok(outlook.includes(w), w);
  assert.doesNotMatch(text, /Jetzt senden|Nachricht senden|Kampagne starten|wurde gesendet|zugestellt/i);
  assert.match(section('gestaltung', 'rechner'), /Gestaltungsbeispiel/); assert.match(section('gestaltung', 'rechner'), /nicht eingerichtet/);
});
test('calculator copy: scope, disclaimer next to the result, honest zero case, ratio only in the details', () => {
  const calc = section('rechner', 'angebot');
  assert.match(calc, /Für einen Standort/); assert.match(calc, /Was würde dieses Szenario für dein Geschäft bedeuten\?/);
  assert.match(calc, /Rechenbeispiel, keine Umsatzprognose\. Wareneinsatz, Prämien, zusätzliche Arbeitskosten und Steuern sind nicht berücksichtigt\./);
  assert.match(calc, /910 €/); assert.match(calc, /\+871 €/); assert.match(calc, /\+10\.452 €/); assert.match(calc, /9\.100 €/);
  assert.match(calc, /Bei dieser Annahme übersteigt die Monatsgebühr den Zusatzumsatz\./);
  assert.ok(home.includes('data-zero-note hidden'), 'the fee-exceeds-revenue note exists and is revealed only when the difference is negative');
  assert.doesNotMatch(calc, /Nettogewinn|Netto-Nutzen|Return on|Ihr Geld|verdienst du|mindestens \d/i);
  const detailsAt = home.indexOf('<details class="more">'), ratioAt = home.indexOf('data-out="ratio"');
  assert.ok(detailsAt > 0 && ratioAt > detailsAt, 'the ratio appears only inside the expandable details');
  assert.match(visible(home.slice(detailsAt, home.indexOf('</details>', detailsAt))), /23,3× .*kein Gewinn und keine garantierte Rendite/);
  const calcHtml = home.slice(home.indexOf('data-calc'), home.indexOf('id="angebot"'));
  assert.equal((calcHtml.match(/data-range="/g) ?? []).length, 4); assert.equal((calcHtml.match(/data-in="/g) ?? []).length, 4);
});
test('offer: what 39 € means, what is included, what is outlook, what happens next', () => {
  const offer = section('angebot', 'anfrage');
  assert.match(offer, /39 € \/ Monat \/ Standort/); assert.match(offer, /Aktuell enthalten/); assert.match(offer, /Gezeigter Ausblick · gesondert zu vereinbaren/);
  assert.match(offer, /Vorläufiger Einstiegspreis\. Konditionen besprechen wir vor dem Start persönlich\./);
  assert.equal((home.match(/<details><summary>/g) ?? []).length, 6, 'six FAQ disclosures');
  assert.match(offer, /Wann wird eine Empfehlung belohnt\?/);
  assert.match(section('anfrage', 'xx'.repeat(0) + 'anfrage') + visible(home.slice(home.indexOf('id="anfrage"'))), /Anfrage senden[\s\S]*Wir melden uns[\s\S]*Demo am Beispiel deines Geschäfts/);
});
test('the contact section states the honest mail-draft behaviour and promises no response time', () => {
  const contact = visible(home.slice(home.indexOf('id="anfrage"')));
  assert.match(contact, /Deine Anfrage wird in deinem E-Mail-Programm geöffnet\. Gesendet wird sie erst dort\./);
  assert.match(contact, /E-Mail vorbereiten/); assert.match(contact, /Geschäft[\s\S]*Branche optional[\s\S]*Kurze Nachricht optional/);
  assert.doesNotMatch(contact, /Anfrage gesendet|erfolgreich übermittelt|Vielen Dank für deine Anfrage|innerhalb von|binnen|24 Stunden|werktags/i);
  assert.match(home, /id="request-copy" type="button" hidden/); assert.match(home, /id="request-figures" hidden/);
});
test('metadata is complete and indexable on the home page', () => {
  assert.match(home, /<title>Loynara – /);
  for (const marker of ['name="description"', 'rel="canonical" href="https://getloynara.com/"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"', 'rel="icon"', 'name="robots" content="index,follow"']) assert.ok(home.includes(marker), marker);
});
test('publication changes survive: legal links, no terms link, legal fragments rendered, placeholders noindex', () => {
  for (const href of ['/impressum/', '/datenschutz/']) assert.ok(home.includes(`href="${href}"`), href);
  assert.doesNotMatch(home, /Teilnahmebedingungen|teilnahmebedingungen/);
  assert.match(legalPage('impressum', { impressum: null, datenschutz: null }), /noindex,nofollow/);
  assert.match(legalPage('impressum', { impressum: '<p>Beispiel</p>', datenschutz: null }), /index,follow/);
  const real = readFileSync(resolve(import.meta.dirname, '../legal/impressum.html'), 'utf8');
  assert.match(real, /Kassel/); assert.match(legalPage('impressum', { impressum: real, datenschutz: null }), /Friedrich-Ebert-Straße 70/);
});
test('robustness CSS: solid header fallback, prefixed blur, print shows every tab view and drops sticky positioning, no color-mix', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../final/final.css'), 'utf8');
  assert.match(css, /\.top\{position:sticky;[^}]*background:var\(--canvas\)/);
  assert.match(css, /@supports \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{\.top\{background:rgba\(246,243,236,\.92\);-webkit-backdrop-filter:[^}]*backdrop-filter:/);
  assert.match(css, /@media print\{\.top\{position:static\}\[data-show\]\[hidden\]\{display:block!important\}/);
  assert.doesNotMatch(css, /color-mix\(/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
