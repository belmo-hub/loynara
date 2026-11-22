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
const browserSrc = readFileSync(resolve(import.meta.dirname, '../src/home-browser.ts'), 'utf8');

test('the page has the website-set order with exactly one h1 and the approved headlines', () => {
  const ids = ['top', 'ablauf', 'geschaefte', 'funktionen', 'rechner', 'preis', 'fragen', 'anfrage'].map(id => home.indexOf(`id="${id}"`));
  assert.ok(ids.every(i => i > 0)); assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.equal((home.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(text, /Ein guter Besuch\. Ein Grund, wiederzukommen\./);
  assert.match(section('top', 'ablauf'), /Die digitale Stempelkarte für deinen Tresen\. Tippe auf das Schild wie dein Kunde: Dein Team bestätigt, der Stempel landet\./);
  for (const h of ['Für jedes Geschäft mit Stammkunden.', 'Was zu deiner Karte gehört.', 'Was wäre ein zusätzlicher Besuch wert?', 'Ein Preis pro Standort.', 'Gut zu wissen.', 'Gib dem nächsten Besuch einen Grund.']) assert.ok(text.includes(h), h);
  assert.doesNotMatch(text, /Theke|Inhaber/, 'the place is the Tresen, the reader is du');
});
test('hero: the sign is a real button that says what it does and that nothing is saved; no video, quiet login', () => {
  const hero = home.slice(home.indexOf('class="hero"'), home.indexOf('id="ablauf"'));
  assert.match(hero, /<button class="tap" id="tap" type="button" aria-label="Hier tippen: einen Stempel auf der Beispielkarte vergeben" aria-describedby="tapNote">/);
  assert.match(hero, /<p class="sr" id="tapNote">Beispiel\. Nichts wird gespeichert\.<\/p>/);
  assert.match(hero, /<p class="sr" role="status" id="tapStatus"><\/p>/, 'the booking is announced');
  assert.match(hero, /id="heroPhone" aria-hidden="true"/, 'the drawing is decorative; the status line carries the result');
  assert.match(visible(hero), /Pizzeria Da Gino Noch 5 Stempel bis zu deiner Prämie: Pizza aufs Haus ab 8 Stempeln Beispiel 3 von 8/);
  assert.doesNotMatch(home, /<video|autoplay/);
  assert.match(home, /<a class="login" href="https:\/\/app\.getloynara\.com\/login">Anmelden<\/a>/);
  assert.match(browserSrc, /Noch \$\{STAMPS - have\} Stempel bis zu deiner Prämie:/); assert.match(browserSrc, /Deine Prämie ist bereit:/);
});
test('scene: four steps with real headings in the order of one visit, each with a still for reduced motion', () => {
  const scene = home.slice(home.indexOf('id="ablauf"'), home.indexOf('id="geschaefte"'));
  assert.deepEqual([...scene.matchAll(/<article class="step[^"]*"><div><h2>([^<]+)<\/h2>/g)].map(m => m[1]), ['Antippen. Ohne App.', 'Dein Team bestätigt.', 'Der Stempel landet.', 'Und manchmal eine Nachricht.']);
  assert.equal((scene.match(/<div class="still" aria-hidden="true">/g) ?? []).length, 4);
  assert.match(scene, /<div class="track" aria-hidden="true">/); assert.match(scene, /<div class="objs" aria-hidden="true">/);
  assert.match(visible(scene), /Höchstens zwei Nachrichten in sieben Tagen, und nur, wenn er zugestimmt hat\./);
  const css = readFileSync(resolve(import.meta.dirname, '../design/home.css'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*\.still\{display:flex/, 'reduced motion stacks the stills');
});
test('the start buttons open the app sign-up, the demo buttons the request form with its wish', () => {
  const actions = [...home.matchAll(/<a class="btn [^"]*"[^>]*>/g)].map(m => m[0]);
  assert.ok(actions.length >= 8);
  const start = actions.filter(a => a.includes(SITE.registerUrl));
  assert.equal(start.length, 5, 'header, hero, phone row, price card, sticky bar');
  for (const a of actions) assert.match(a, /href="https:\/\/app\.getloynara\.com\/register"|href="#rq" data-want="demo"/, a);
  assert.equal(SITE.registerUrl, `${SITE.appOrigin}/register`);
  assert.doesNotMatch(home, /href="[^"\s]*(?:sign-up|signup|checkout)[^"\s]*"/i);
  assert.match(home, /<nav class="bar" id="bar" aria-label="Anfrage" inert><a class="btn btn-sec" href="#rq" data-want="demo">Demo anfragen<\/a><a class="btn btn-pri" href="https:\/\/app\.getloynara\.com\/register">1\. Monat gratis<\/a><\/nav>/);
});
test('nothing covers a control or a jump target: hero buttons take clicks, the header and the bar leave room, no long label from 1024 to 1119 px', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../design/home.css'), 'utf8');
  assert.match(css, /\.tapzone\{[^}]*pointer-events:none\}\n\.tapzone \.tap\{pointer-events:auto\}/, 'the tap zone lies over the hero side buttons');
  assert.match(css, /\.tap\{[^}]*--plw:min\(420px,calc\(var\(--hero-pw\) \+ 96px\)\)/, 'the sign follows the phone, so it never reaches the side buttons');
  assert.match(css, /@media \(min-width:1024px\)\{\.hero\{--hero-pw:clamp\(208px,calc\(40vh - 82px\),268px\)\}/, 'the phone follows the window height, so short laptop windows keep the sign and both buttons on the first screen');
  assert.ok(css.indexOf('.tap{--plw:calc(var(--hero-pw) + 72px)}') > css.indexOf('.tap{position:relative'), 'the narrow-desktop sign width comes after the base rule, or the base wins');
  assert.match(css, /@media \(min-width:1024px\)\{html\{scroll-padding-top:96px\}\}/); assert.match(css, /@media \(max-width:1023px\)\{html\{scroll-padding-bottom:calc\(var\(--bar\) \+ 16px\)\}\}/);
  assert.match(css, /@media \(min-width:1024px\) and \(max-width:1119px\)\{\.long\{display:none\}\.short\{display:inline\}\}/);
  assert.match(css, /\.shops \.shop:not\(\.show\)\{display:none\}/, 'a chip hides every other shop card, the large one too');
  assert.match(home, /<nav class="bar" id="bar" aria-label="Anfrage" inert>/, 'hidden, the bar is out of the tab order until the script shows it');
  assert.match(browserSrc, /bar\.inert = !bar\.classList\.toggle\('show', actsGone && !atClose\)/);
});
test('the brand mark is the real logo, in the header and on every sign; without script the scene is stacked stills', () => {
  assert.match(home, /<a class="brand" href="\/" aria-label="Loynara, zur Startseite"><img class="mark-img" src="\/assets\/loynara-mark\.svg" width="38" height="38" alt="">Loynara<\/a>/);
  assert.equal((home.match(/<span class="pl"><i aria-hidden="true"><img src="\/assets\/loynara-mark\.svg" alt="">/g) ?? []).length, 4, 'hero sign, still, scene sign, bookend');
  assert.doesNotMatch(home, /<i>L<\/i>|class="mark"/, 'no drawn stand-in');
  assert.match(home, /<noscript><link rel="stylesheet" href="\/home-static\.css"><\/noscript>/);
  const scene = home.slice(home.indexOf('id="scenePhone"'), home.indexOf('id="geschaefte"'));
  assert.match(scene, /Noch 5 Stempel bis zu deiner Prämie:/); assert.match(scene, /<span id="sceneCount">3 von 8<\/span>/);
  assert.equal((scene.slice(scene.indexOf('id="sceneStamps"'), scene.indexOf('id="sceneCount"')).match(/class="st on"/g) ?? []).length, 3, 'the static scene is the state the script starts from');
  assert.match(browserSrc, /if \(location\.hash === '#anfrage'\) want\.value = 'demo';/, '„Demo anfragen“ on the other pages sets its wish');
});
test('price, support address, login and app origin are the approved ones; the price lives in one place', () => {
  assert.equal(SITE.price.amount, 49); assert.equal(SITE.supportEmail, 'support@getloynara.com'); assert.equal(SITE.loginUrl, 'https://app.getloynara.com/login');
  assert.match(text, /49 € pro Monat und Standort/); assert.match(text, /Kunden, Karten und dein Team kosten nichts extra/);
  assert.ok(home.includes('mailto:support@getloynara.com')); assert.ok(home.includes('href="https://app.getloynara.com/login"'));
  assert.doesNotMatch(home, /getlyonara/i);
  const src = ['../template.ts', '../src/home.ts', '../src/home-browser.ts', '../src/calc.ts'].map(f => readFileSync(resolve(import.meta.dirname, f), 'utf8')).join('\n');
  assert.ok(!/(?<![#\d,.])\b(?:39|49)\b(?![\d,.;])/.test(src), 'the fee is never hard-coded outside src/site.ts');
});
test('free month and notice period: only the pilot terms, in Legal\'s wording, and no VAT line', () => {
  assert.match(text, /Der erste Monat ist gratis\. Zahlungsdaten erst ab dem zweiten Monat\. Monatlich kündbar, keine Einrichtungsgebühr\./);
  assert.match(text, /Der erste Monat ist gratis, Zahlungsdaten brauchen wir erst ab dem zweiten Monat\. Hörst du im ersten Monat auf, kostet es nichts\. Sonst läuft es Monat für Monat weiter\. Kündigen kannst du zum Ende jedes Abrechnungsmonats, spätestens 14 Tage vorher\. Eine Einrichtungsgebühr gibt es nicht, und Kunden, Karten und dein Team kosten nichts extra\./);
  assert.doesNotMatch(text, /unverbindlich|endet automatisch|sofort|ab Tag 1|jederzeit kündbar|ohne Risiko/i);
  assert.doesNotMatch(text, /zzgl\.|inkl\.|MwSt|Umsatzsteuer|netto|brutto/i);
});
test('no stale price, internal wording or old brand', () => {
  assert.doesNotMatch(text, /\b39\s*€|\b69\s*€|\b99\s*€|\b397\b|Rabatt|Jahresrabatt|nur noch|begrenzt|kostenlos|Testphase|Probemonat/i);
  assert.doesNotMatch(text, /LoopLocal|synthetic|synthetisch|Audit|Entwurf|nicht geprüft|nicht getestet|in Vorbereitung|Testdaten|lokal getestet/i);
});
test('no fabricated proof, misleading referral economics or unsupported availability claims', () => {
  assert.doesNotMatch(text, /Testimonial|Referenz(?:kunden)?\b|bereits im Einsatz|vertrauen uns|\d[\d.]* (?:zufriedene )?Kunden nutzen|\bgarantiert\b|Garantie auf|mehr Umsatz um|ROI\b|Rendite von|Gewinn von|spart? Zeit/i);
  assert.doesNotMatch(text, /Kundengewinnung für 0|kostenlose Neukunden|Neukunden gratis|Akquise(?:kosten)? von|pro Neukunde|Cost per|mehr Neukunden/i);
  assert.doesNotMatch(text, /iPhone|Android|alle Handys|jedes Smartphone|Apple Pay|Google Pay|Smart Tap|Apple VAS|automatische Vergabe|Bezahlen per NFC|Zu Wallet hinzufügen|Add to Wallet/i);
  assert.doesNotMatch(text, /[Zz]ertifiziert|Acryl|Lieferzeit|Lieferung|Material|\d+\s?(?:cm|mm)\b|im Preis (?:enthalten|inbegriffen)/);
  assert.doesNotMatch(home, /<img[^>]+(?:logo-wall|partner|kunden-logo)/i);
});
test('every invented shop and every drawing with figures is marked as an example', () => {
  for (const name of ['Barbershop Kaan', 'Studio Aylin', 'Imbiss am Markt', 'Café Morgenlicht']) assert.match(home, new RegExp(`<b>${name}</b><small>Beispiel`), name);
  assert.match(home, /<p class="ex">Beispielzahlen · Buchungen pro Tag, sonntags geschlossen<\/p>/);
  assert.ok((home.match(/Beispiel/g) ?? []).length >= 16);
});
test('offer: what is included, Wallet messages stay outlook, nothing is sent from this page', () => {
  const offer = section('preis', 'fragen');
  assert.match(offer, /49 € pro Monat und Standort/);
  for (const x of ['Stempel- oder Punktekarte mit deinen Prämien', 'NFC-Antippen und QR-Einstieg am Tresen', 'Bestätigung durch dein Team, mit Rollen', 'Apple Wallet auf Wunsch. Nachrichten zeigen wir als Ausblick und vereinbaren sie gesondert', 'Empfehlungen und Willkommen-zurück-Bonus', 'Happy Hour bei Punkten nach Einkaufswert, Geburtstags-Bonus mit Apple Wallet', 'Überblick, wie viele wiederkommen', 'Kunden, Karten und dein Team kosten nichts extra']) assert.ok(offer.includes(x), x);
  assert.equal((home.match(/<details><summary>/g) ?? []).length, 7, 'seven FAQ disclosures');
  assert.doesNotMatch(text, /Jetzt senden|Nachricht senden|Kampagne starten|wurde gesendet|zugestellt/i);
  assert.match(text, /Loynara ist keine Kassenanbindung und kein Bezahlsystem\./);
});
test('calculator copy: disclaimer next to the result, the live example figures, sliders that speak', () => {
  const calc = section('rechner', 'preis');
  assert.match(calc, /Was wäre ein zusätzlicher Besuch wert\?/); assert.match(calc, /Deine Annahme, kein Erfahrungswert von Loynara\./);
  assert.match(calc, /Rechenbeispiel bei 26 Öffnungstagen, keine Umsatzprognose\. Wareneinsatz, Prämien, zusätzliche Arbeitskosten und Steuern sind nicht berücksichtigt\./);
  assert.match(calc, /910 €/); assert.match(calc, /\+861 €/);
  assert.doesNotMatch(calc, /Nettogewinn|Netto-Nutzen|Return on|Ihr Geld|verdienst du|mindestens \d/i);
  const calcHtml = home.slice(home.indexOf('id="rechner"'), home.indexOf('id="preis"'));
  assert.equal((calcHtml.match(/<input id="[kwz]" type="range" [^>]*aria-valuetext="/g) ?? []).length, 3);
  assert.match(calcHtml, /<p class="sr" aria-live="polite" id="calcSay"><\/p>/);
  assert.match(browserSrc, /wholeEuros\(compute\(\{ visits: k, basket: w, days: 26, gain: z \}, SITE\.price\.amount\)\)/, 'the live maths, not a second formula');
});
test('the contact section states the honest mail-draft behaviour and promises no response time', () => {
  const contact = visible(home.slice(home.indexOf('id="anfrage"')));
  assert.match(contact, /Die Anfrage wird in deinem E-Mail-Programm geöffnet\. Gesendet wird sie erst dort\./);
  assert.match(contact, /E-Mail vorbereiten/); assert.match(contact, /Text kopieren/); assert.match(contact, /Geschäft[\s\S]*Branche optional[\s\S]*Was möchtest du\?[\s\S]*Kurze Nachricht optional/);
  assert.match(contact, /Anfrage senden[\s\S]*Wir melden uns[\s\S]*Start an deinem Tresen/);
  assert.doesNotMatch(contact, /Anfrage gesendet|erfolgreich übermittelt|Vielen Dank für deine Anfrage|innerhalb von|binnen|24 Stunden|werktags/i);
  assert.match(home, /<input id="rq-shop" name="shop" autocomplete="organization" maxlength="120" required aria-describedby="rq-err">/);
  assert.match(home, /<p class="sent" role="status" id="rq-sent"><\/p>/);
});
test('metadata is complete and indexable; the page carries no inline style or script (CSP)', () => {
  assert.match(home, /<title>Loynara: Die Stempelkarte für deinen Tresen<\/title>/);
  for (const name of ['property="og:title"', 'name="twitter:title"']) assert.ok(home.includes(`${name} content="Loynara: Die Stempelkarte für deinen Tresen"`), `${name} is the page title, not a promised result`);
  for (const name of ['property="og:description"', 'name="twitter:description"']) assert.ok(home.includes(`${name} content="Digitale Stempel- und Punktekarte für kleine Geschäfte. Antippen oder QR-Code, ohne App. Dein Team bestätigt jeden Stempel."`), name);
  const shareImage = readFileSync(resolve(import.meta.dirname, '../site/assets/social-preview.svg'), 'utf8');
  assert.match(shareImage, /Die Stempelkarte/); assert.doesNotMatch(shareImage + home, /Aus Kunden werden Stammkunden/, 'the share preview names the product, it promises no result');
  assert.match(home, /name="description" content="Digitale Stempel- und Punktekarte für kleine Geschäfte\. Dein Team bestätigt jeden Stempel\. 49 € pro Monat und Standort, erster Monat gratis\."/);
  for (const marker of ['rel="canonical" href="https://getloynara.com/"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"', 'rel="icon"', 'name="robots" content="index,follow"', '<link rel="stylesheet" href="/home.css">', '<script type="module" src="/assets/home.js"></script>', '<a class="skip" href="#inhalt">Zum Inhalt springen</a>']) assert.ok(home.includes(marker), marker);
  assert.doesNotMatch(home, /\sstyle="|<style|<script(?![^>]*\ssrc=)|\son[a-z]+="/);
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
  assert.match(css, /@supports \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{\.top\{background:rgba\(238,240,239,\.92\);-webkit-backdrop-filter:[^}]*backdrop-filter:/);
  assert.match(css, /@media print\{\.top\{position:static\}\[data-show\]\[hidden\]\{display:block!important\}/);
  assert.doesNotMatch(css, /color-mix\(/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
test('NFC is live: the tap comes first and the QR code always stays the fallback; Apple Wallet on request, never Google Wallet (set only after the physical NFC acceptance passed in production)', () => {
  const head = home.slice(0, home.indexOf('</head>'));
  assert.match(head, /property="og:description" content="[^"]*Antippen oder QR-Code, ohne App/, 'social metadata names the tap and the QR code');
  assert.doesNotMatch(head, /Ausblick|vorbereitet/);
  assert.match(section('top', 'ablauf'), /Antippen oder QR-Code, ohne App\./);
  const mentions = text.match(/[^.?]*NFC[^.?]*[.?]/g) ?? [];
  assert.ok(mentions.length > 0 && mentions.every(m => !/Ausblick|vorbereitet/.test(m)), mentions.join(' | '));
  assert.match(text, /Und wenn ein Handy kein NFC kann\? Dann scannt dein Kunde den QR-Code\. Er öffnet dieselbe Karte und bleibt immer als Alternative\./);
  for (const m of text.match(/[^.?]*Wallet[^.?]*[.?]/g) ?? []) assert.match(m, /Ausblick|auf Wunsch|\?$/, m);
  assert.doesNotMatch(text, /Google Wallet/);
});
