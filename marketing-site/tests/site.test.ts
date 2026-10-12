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
const defaultVisible = visible(home.replace(/<div class="ov"[^>]*\shidden[^>]*>[\s\S]*?(?=<div class="ov"|<\/div><\/div><\/div><\/section>)/g, ' '));

test('the page has the Concept D scene order with exactly one h1 and the approved headline', () => {
  const ids = ['hero', 'ablauf', 'empfehlung', 'gestaltung', 'inhaber', 'rechner', 'angebot', 'anfrage'].map(id => home.indexOf(`id="${id}"`));
  assert.ok(ids.every(i => i > 0)); assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.equal((home.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(text, /Ein guter Besuch\. Ein Grund, wiederzukommen\./);
  assert.match(section('hero', 'ablauf'), /Behalte die Kunden, die du gewonnen hast\. Bring sie zurück\. Lass sie die nächsten mitbringen\./);
  for (const h of ['Ein Besuch. Ein Stempel. Bestätigt von deinem Team.', 'Deine Stammkunden bringen den nächsten Kunden mit.', 'Deine Marke. Vom Tresen bis zur Kundenkarte.', 'Du siehst, wer wiederkommt. Und wann du etwas tun kannst.', 'Was wäre ein zusätzlicher Besuch wert?', 'Ein Preis pro Standort. Ohne App für deine Kunden.', 'Gib dem nächsten Besuch einen Grund. Und der nächsten Empfehlung einen Weg.']) assert.ok(text.includes(h), h);
});
test('hero: one product composition, CTA hierarchy, quiet login, CTA scrolls to the contact section', () => {
  const hero = home.slice(home.indexOf('id="hero"'), home.indexOf('class="roles"'));
  assert.match(hero, /<a class="btn btn-primary" href="#anfrage">Demo anfragen<\/a><a class="btn btn-ghost" href="#ablauf">So funktioniert’s<\/a>/);
  assert.equal((hero.match(/class="phone/g) ?? []).length, 1, 'one phone'); assert.equal((hero.match(/class="stand-obj"/g) ?? []).length, 1, 'one stand');
  assert.equal((hero.match(/class="cue"/g) ?? []).length, 1, 'one confirmation cue');
  assert.doesNotMatch(hero, /wpass|owner|ref-pair/, 'no Wallet, owner or referral object in the hero');
  assert.match(home, /<a class="login" href="https:\/\/app\.getloynara\.com\/login">Anmelden<\/a>/);
});
test('zero interaction: roles, flow, referral rule, owner value, branding, price and next step are visible by default', () => {
  assert.match(visible(home.slice(home.indexOf('class="roles"'), home.indexOf('id="ablauf"'))), /Kunde Scannt den Code, sammelt bis zur Prämie\. Team Bestätigt den Besuch mit einem Tipp\. Inhaber Sieht, wer wiederkommt – Stand und Verlauf jeder Karte\./);
  assert.match(section('ablauf', 'empfehlung'), /Karte öffnen[\s\S]*Team bestätigt[\s\S]*Stempel wächst[\s\S]*Prämie einlösen/);
  assert.match(section('empfehlung', 'gestaltung'), /Link geteilt[\s\S]*Karte erstellt[\s\S]*Erster Besuch bestätigt[\s\S]*Bonus verbucht/);
  assert.match(section('empfehlung', 'gestaltung'), /Teilen, Öffnen oder Anmelden allein bringt keinen Bonus/);
  for (const re of [/Wer kommt wieder\?/, /Wer fehlt\?/, /Wann ist es ruhig\?/, /12 wiederholte Besuche/, /Aufsteller/, /Gestaltungsbeispiel/, /Wallet-Vorschau/, /49 € \/ Monat \/ Standort|49 € pro Monat und Standort/, /Demo anfragen/]) assert.match(defaultVisible, re, String(re));
});
test('interactive modules: two real tablists (screen, owner), roving tabindex, one tabpanel each', () => {
  assert.equal((home.match(/role="tablist"/g) ?? []).length, 2);
  assert.equal((home.match(/role="tab"/g) ?? []).length, 5);
  assert.equal((home.match(/role="tabpanel"/g) ?? []).length, 2);
  assert.equal((home.match(/aria-selected="true"/g) ?? []).length, 2);
  assert.ok(home.includes('data-act="visit"') && home.includes('data-act="ref"'), 'the two demos are single explicit actions, not tabs');
});
test('price, support address, login and app origin are the approved ones; the price lives in one place', () => {
  assert.equal(SITE.price.amount, 49); assert.equal(SITE.supportEmail, 'support@getloynara.com'); assert.equal(SITE.loginUrl, 'https://app.getloynara.com/login');
  assert.match(text, /49 € \/ Monat \/ Standort/); assert.match(text, /Pilotangebot – Details im persönlichen Gespräch/);
  assert.ok(home.includes('mailto:support@getloynara.com')); assert.ok(home.includes('href="https://app.getloynara.com/login"'));
  assert.doesNotMatch(home, /getlyonara/i);
  const src = ['../template.ts', '../src/final-parts.ts', '../src/d-parts.ts', '../src/d.ts', '../src/calc.ts', '../src/demo.ts', '../src/ref.ts'].map(f => readFileSync(resolve(import.meta.dirname, f), 'utf8')).join('\n');
  assert.ok(!/(?<![#\d,.])\b39\b(?![\d,.;])/.test(src), 'the fee is never hard-coded outside src/site.ts');
});
test('no stale price, internal wording or old brand', () => {
  assert.doesNotMatch(text, /\b69\s*€|\b99\s*€|\b397\b|Einrichtungsgebühr|Rabatt|Jahresrabatt|nur noch|begrenzt|kostenlos|Testphase|Probemonat|Kündigung|zzgl\.|inkl\./i);
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
  const owner = home.slice(home.indexOf('id="inhaber"'), home.indexOf('id="rechner"'));
  assert.equal((owner.match(/Plattform-Ausblick · Beispiel/g) ?? []).length, 2, 'both outlook views are labelled');
  assert.equal((owner.match(/Vorschau · nicht versendet/g) ?? []).length, 2);
  assert.match(visible(owner), /Der Überblick gehört zum Pilotangebot\. Wer fehlt und ruhige Zeiten sind Plattform-Ausblick; Nachrichten bleiben Vorschau\./);
  const card = visible(home.slice(home.indexOf('class="price-card"'), home.indexOf('class="faq"')));
  const included = card.slice(0, card.indexOf('Demo anfragen'));
  assert.doesNotMatch(included, /Kampagn|Nachricht|Wallet|Aufsteller|Logo-Darstellung/);
  assert.match(card, /Aufsteller, NFC-Antippen, Wallet-Karte, Logo-Darstellung, Kampagnen und Nachrichten zeigen wir als Ausblick und vereinbaren sie gesondert\./);
  assert.doesNotMatch(text, /Jetzt senden|Nachricht senden|Kampagne starten|wurde gesendet|zugestellt/i);
  assert.match(section('gestaltung', 'inhaber'), /Gestaltungsbeispiel und Ausblick\. Nichts wird hochgeladen oder gespeichert\./);
});
test('calculator copy: scope, disclaimer next to the result, honest zero case, ratio only in the details', () => {
  const calc = section('rechner', 'angebot');
  assert.match(calc, /Für einen Standort/); assert.match(calc, /Was wäre ein zusätzlicher Besuch wert\?/);
  assert.match(calc, /Rechenbeispiel, keine Umsatzprognose\. Wareneinsatz, Prämien, zusätzliche Arbeitskosten und Steuern sind nicht berücksichtigt\./);
  assert.match(calc, /910 €/); assert.match(calc, /\+861 €/); assert.match(calc, /\+10\.332 €/); assert.match(calc, /9\.100 €/);
  assert.match(calc, /Bei dieser Annahme übersteigt die Monatsgebühr den Zusatzumsatz\./);
  assert.ok(home.includes('data-zero-note hidden'));
  assert.doesNotMatch(calc, /Nettogewinn|Netto-Nutzen|Return on|Ihr Geld|verdienst du|mindestens \d/i);
  const detailsAt = home.indexOf('<details class="more">'), ratioAt = home.indexOf('data-out="ratio"');
  assert.ok(detailsAt > 0 && ratioAt > detailsAt, 'the ratio appears only inside the expandable details');
  assert.match(visible(home.slice(detailsAt, home.indexOf('</details>', detailsAt))), /18,6× .*kein Gewinn und keine garantierte Rendite/);
  const calcHtml = home.slice(home.indexOf('data-calc'), home.indexOf('id="angebot"'));
  assert.equal((calcHtml.match(/data-range="/g) ?? []).length, 4); assert.equal((calcHtml.match(/data-in="/g) ?? []).length, 4);
});
test('offer: what 49 € means, what is included, the pilot qualifier and what happens next', () => {
  const offer = section('angebot', 'anfrage');
  assert.match(offer, /49 € pro Monat und Standort/); assert.match(offer, /Pilotangebot – Details im persönlichen Gespräch/);
  for (const x of ['Digitale Treuekarte mit Stempeln oder Punkten', 'Prämien und Einlösung', 'QR-Einstieg am Tresen', 'Bestätigung durch dein Team, mit Rollen', 'Empfehlungen', 'Kundenübersicht und Auswertung', 'Mehrere Standorte']) assert.ok(offer.includes(x), x);
  assert.match(offer, /Vorläufiger Einstiegspreis\. Konditionen besprechen wir vor dem Start persönlich\./);
  assert.equal((home.match(/<details><summary>/g) ?? []).length, 7, 'seven FAQ disclosures including live correction');
  assert.match(visible(home.slice(home.indexOf('id="anfrage"'))), /Anfrage senden[\s\S]*Wir melden uns[\s\S]*Demo am Beispiel deines Geschäfts/);
});
test('the contact section states the honest mail-draft behaviour and promises no response time', () => {
  const contact = visible(home.slice(home.indexOf('id="anfrage"')));
  assert.match(contact, /Die Anfrage wird in deinem E-Mail-Programm geöffnet\. Gesendet wird sie erst dort\./);
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
  const css = readFileSync(resolve(import.meta.dirname, '../design/d.css'), 'utf8');
  assert.match(css, /\.top\{position:sticky;[^}]*background:var\(--canvas\)/);
  assert.match(css, /@supports \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{\.top\{background:rgba\(246,243,236,\.92\);-webkit-backdrop-filter:[^}]*backdrop-filter:/);
  assert.match(css, /@media print\{\.top\{position:static\}\[data-show\]\[hidden\]\{display:block!important\}/);
  assert.doesNotMatch(css, /color-mix\(/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
test('NFC is shown only as outlook: QR is the way in today (physical NFC acceptance has not run)', () => {
  const offerIncluded = visible(home.slice(home.indexOf('class="checks"'), home.indexOf('</ul>', home.indexOf('class="checks"'))));
  assert.doesNotMatch(offerIncluded, /NFC/);
  assert.doesNotMatch(home.slice(0, home.indexOf('</head>')), /NFC/, 'no NFC in title, description or social metadata');
  assert.doesNotMatch(visible(home.slice(home.indexOf('id="hero"'), home.indexOf('id="ablauf"'))), /NFC|antippen|tippt/i);
  const mentions = text.match(/NFC[^.]*\./g) ?? [];
  assert.ok(mentions.length > 0 && mentions.every(m => /Ausblick|Antippen\?|NFC-Antippen/.test(m) || /NFC zum Antippen/.test(m)), mentions.join(' | '));
  assert.match(text, /Das Antippen per NFC ist vorbereitet; wir zeigen es als Ausblick\. Gestartet wird mit dem QR-Code\./);
});

