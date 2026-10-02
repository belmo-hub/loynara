import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homePage, legalPage } from '../template.js';
import { SITE } from '../src/site.js';

const home = homePage();
const text = home.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

test('price, support address, login and app origin are the approved ones', () => {
  assert.equal(SITE.price.amount, 39);
  assert.match(text, /39 €\s*\/ Monat \/ Standort/);
  assert.match(text, /Pilotangebot – Details im persönlichen Gespräch/);
  assert.ok(home.includes('mailto:support@getloynara.com'));
  assert.ok(home.includes('href="https://app.getloynara.com/login"'));
  assert.doesNotMatch(home, /getlyonara/i);
});
test('no retired price, internal wording, old brand or unsupported claim appears in the public copy', () => {
  assert.doesNotMatch(text, /\b49\s*€|€\s*49|\b69\s*€|\b99\s*€|Einrichtungsgebühr|Rabatt|jährlich|ROI|Umsatzprognose/);
  assert.doesNotMatch(text, /LoopLocal|synthetic|synthetisch|Audit|Entwurf|nicht geprüft|nicht getestet|in Vorbereitung|Pilot-?betrieb|Testdaten|lokal getestet/i);
  assert.doesNotMatch(text, /Apple Wallet|Google Wallet|Smart Tap|VAS|Kampagne|Automation|automatisch(?:e|es)? (?:Stempel|Vergabe)|Bezahlen per NFC/);
  assert.doesNotMatch(text, /iPhone.*verifiziert|bereits im Einsatz|Kunden nutzen/i);
});
test('the NFC flow, the QR alternative and the staff confirmation are all stated', () => {
  const nfc = home.slice(home.indexOf('id="nfc"'), home.indexOf('id="funktionen"')).replace(/<[^>]+>/g, ' ');
  for (const phrase of [/ohne App/, /neue Kunden erstellen ihre Karte/i, /wiederkehrende finden ihre bestehende Karte/i, /bestätigt/, /QR-Code als Alternative/, /kein Bezahlsystem/i]) assert.match(nfc, phrase);
});
test('metadata is complete and indexable on the home page', () => {
  assert.match(home, /<title>Loynara – /);
  for (const marker of ['name="description"', 'rel="canonical" href="https://getloynara.com/"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"', 'rel="icon"', 'name="robots" content="index,follow"']) assert.ok(home.includes(marker), marker);
});
test('legal slots exist; unapproved legal pages are kept out of search results', () => {
  for (const href of ['/impressum/', '/datenschutz/', SITE.termsUrl]) assert.ok(home.includes(`href="${href}"`), href);
  const placeholder = legalPage('impressum', { impressum: null, datenschutz: null });
  assert.match(placeholder, /noindex,nofollow/);
  assert.match(placeholder, /data-legal-placeholder/);
  assert.match(legalPage('impressum', { impressum: '<p>Beispiel</p>', datenschutz: null }), /index,follow/);
});
