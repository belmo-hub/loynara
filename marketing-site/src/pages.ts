/**
 * Supporting pages (Concept D language: headline, one sentence, one product object, one action).
 * Each page has a distinct sales purpose: two first-wave industries and the referral explainer.
 * Claims follow the same boundary as the home page: the entry claim follows the NFC gate in claims.ts, Wallet/messages only as outlook,
 * example data labelled as such, no proof, results or availability that the product cannot show.
 */
import { ENTRY_COPY as E, RECOVERY_COPY as R } from './claims.js';
import { SITE } from './site.js';
import { initialBrand, type BrandState } from './brand.js';
import { cardHtml, statusFor } from './final-parts.js';
import { phone } from './d-parts.js';

export type SubPage = {
  path: string;
  title: string;
  description: string;
  eyebrow: string;
  h1: [string, string];
  lead: string;
  hero: string;
  sections: string[];
  faq: Array<[string, string]>;
  close: { h2: [string, string]; lead: string; subject: string };
};

const price = () => `${SITE.price.amount} €`;
const arrow = '<span aria-hidden="true">→</span>';
const mailto = (subject: string) => `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(subject)}`;
const card = (b: BrandState, name: string, reward: string, balance: number) =>
  phone(`<p class="url" aria-hidden="true">getloynara.com/karte</p>${cardHtml({ balance, status: statusFor(balance), brand: b, example: { name, reward } })}`, 'phone-stage');
/** Break-even example: how many extra visits at a given basket cover the monthly fee. Pure arithmetic, no forecast. */
export const visitsToCoverFee = (basket: number) => Math.ceil(SITE.price.amount / basket);

const steps = (items: Array<[string, string]>) => `<ol class="next">${items.map(([b, s]) => `<li><b>${b}</b><span>${s}</span></li>`).join('')}</ol>`;
const scene = (o: { id?: string; eyebrow: string; h2: [string, string]; lead: string; body?: string; visual: string; flip?: boolean; tone?: 'white' | 'dark' }) =>
  `<section class="sec${o.tone === 'white' ? ' sec-white' : o.tone === 'dark' ? ' dark' : ''}"${o.id ? ` id="${o.id}"` : ''}><div class="wrap scene${o.flip ? ' scene-flip' : ''}"><div class="scene-copy"><p class="eyebrow">${o.eyebrow}</p><h2>${o.h2[0]} <em>${o.h2[1]}</em></h2><p class="lead">${o.lead}</p>${o.body ?? ''}</div><div class="scene-visual">${o.visual}</div></div></section>`;

/** Static referral picture with this page's own example people (same rule as the app: bonus only after the first confirmed visit). */
const refPair = (a: [string, string], f: [string, string], aBal: number) =>
  `<div class="ref-wrap"><p class="fine ref-cap">Beispieldaten</p><div class="ref-pair" data-phase="qualified" role="img" aria-label="Beispiel: ${a[0]} hat ${f[0]} geworben. Nach dem ersten bestätigten Besuch von ${f[0]} bekommt ${a[0]} einen Bonusstempel."><div class="person person-a"><span class="avatar" aria-hidden="true">${a[0][0]}</span><b>${a[0]}</b><small>${a[1]}</small><p class="stamps-num"><span>${aBal + 1}</span>/10</p><p class="bonus">+1 Bonusstempel</p></div><div class="link" aria-hidden="true"><i></i></div><div class="person person-b"><span class="avatar" aria-hidden="true">${f[0][0]}</span><b>${f[0]}</b><small>${f[1]}</small><p class="stamps-num"><span>1</span>/10</p><p class="bonus bonus-none">erster Besuch bestätigt</p></div></div></div>`;

/** What the owner sees today: pseudonymous cards (the real list shows no names), stand and last confirmed visit; example data. */
const ownerToday = (unit: string, rows: Array<[string, string, string]>) =>
  `<div class="owner-card"><p class="ov-meta">Kundenkarten · Beispieldaten</p><p class="ov-note">Pseudonyme Karten: Stand und letzter bestätigter Vorgang. Namen zeigt Loynara nicht.</p><ul class="people">${rows.map(([n, s, t]) => `<li><span class="avatar" aria-hidden="true">${n.slice(-1)}</span><b>${n}</b><small>${t}</small><span class="dots" role="img" aria-label="${s} von 10 ${unit}">${Array.from({ length: 10 }, (_, i) => `<i${i < Number(s) ? ' class="on"' : ''}></i>`).join('')}</span></li>`).join('')}</ul><p class="ov-note">Gezählt wird nur, was dein Team bestätigt hat – nicht dein gesamter Umsatz.</p></div>`;

const breakEven = (basket: number, what: string) => {
  const n = visitsToCoverFee(basket);
  return `<div class="price-card"><p class="price"><b>${price()}</b><span>pro Monat und Standort</span></p><p class="price-note">${SITE.price.note}</p><ul class="checks"><li>Bei rund ${basket} € pro ${what} entspricht das etwa ${n} zusätzlichen ${n === 1 ? 'Besuch' : 'Besuchen'} im Monat.</li><li>Ohne App für deine Kunden, ohne Kassenanbindung.</li><li>Prämie, Bonus und Regeln legst du selbst fest.</li></ul><p class="fine">Rechenbeispiel, keine Prognose. Wareneinsatz, Prämien und Arbeitszeit sind nicht berücksichtigt. <a href="/#rechner">Mit deinen eigenen Zahlen rechnen</a></p></div>`;
};

// ── Barber ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const barberBrand: BrandState = { ...initialBrand(), style: 'graphit' };
export const barber: SubPage = {
  path: '/fuer-barber/',
  title: 'Digitale Stempelkarte für Barbershops – Loynara',
  description: 'Stempelkarte ohne App für deinen Barbershop: Jeder bestätigte Termin zählt, Stammkunden bringen ihre Freunde mit, und du siehst, wer wiederkommt.',
  eyebrow: 'Für Barbershops',
  h1: ['Jeder Schnitt zählt.', 'Auch für den nächsten Termin.'],
  lead: 'Deine Kunden sammeln bei jedem bestätigten Termin einen Stempel – ohne App. Beim zehnten gibt es eine Bartpflege dazu. Und wer zufrieden ist, bringt seinen Kumpel mit.',
  hero: card(barberBrand, 'Studio Schnittwerk', 'eine Bartpflege als Extra', 7),
  sections: [
    scene({ id: 'ablauf', eyebrow: 'Am Stuhl', h2: ['Du schneidest.', 'Die Karte zählt mit.'], lead: 'Beim Bezahlen zeigt der Kunde seine Karte auf dem Handy. Du scannst, bestätigst – fertig. Kein Stempelkissen, keine verlorenen Pappkarten.',
      body: steps([['Einmal anmelden', E.pageSignup], ['Bei jedem Termin', 'Karte zeigen, du scannst und bestätigst. Erst dann gibt es den Stempel.'], ['Beim zehnten Termin', 'Die Prämie wird mit einem Tipp eingelöst. Die Karte beginnt von vorn.']]),
      visual: card(barberBrand, 'Studio Schnittwerk', 'eine Bartpflege als Extra', 10) }),
    scene({ id: 'empfehlung', tone: 'white', flip: true, eyebrow: 'Empfehlungen', h2: ['Barber leben von Mundpropaganda.', 'Jetzt zählt sie.'], lead: 'Dein Stammkunde teilt seinen Link. Kommt sein Kumpel zum ersten Mal und du bestätigst den Termin, bekommen beide den Bonus, den du festlegst.',
      body: '<p class="fine">Teilen, Öffnen oder Anmelden allein bringt keinen Bonus. <a href="/empfehlungen/">So funktionieren Empfehlungen</a></p>',
      visual: refPair(['Deniz', 'Stammkunde'], ['Tim', 'neu dabei'], 6) }),
    scene({ id: 'inhaber', eyebrow: 'Für dich als Inhaber', h2: ['Du siehst, wie viele wiederkommen.', 'Und welche Karten länger ruhen.'], lead: 'Die Auswertung zählt wiederkehrende Karten. Pro Karte siehst du Stand, bestätigte Termine und den letzten Besuch – auch ohne Buchungssoftware. Die Karten sind pseudonym.',
      body: '<p class="fine">Eine Liste aller Karten, die länger nicht da waren, und Nachrichten an diese Kunden zeigen wir als Ausblick.</p>',
      visual: ownerToday('Stempel', [['Karte A', '7', 'letzter Besuch vor 3 Wochen'], ['Karte B', '1', 'neu, geworben'], ['Karte C', '4', 'letzter Besuch vor 9 Wochen']]) }),
    `<section class="sec sec-white" id="angebot"><div class="wrap offer-grid"><div class="offer-copy"><p class="eyebrow">Was es kostet</p><h2>Ein Preis pro Laden. <em>Egal, wie viele Stühle.</em></h2><p class="lead">Wir zeigen dir den Ablauf an deinem eigenen Laden und besprechen den Start persönlich.</p></div>${breakEven(25, 'Haarschnitt')}</div></section>`,
  ],
  faq: [
    ['Brauchen meine Kunden eine App?', E.pageAppAnswer],
    ['Was, wenn ich gerade schneide?', 'Bestätigt wird beim Bezahlen, nicht mitten im Schnitt. Das dauert nicht länger, als eine Pappkarte zu stempeln.'],
    ['Kann ein Kunde sich selbst stempeln?', 'Nein. Einen Stempel gibt es nur, wenn du oder dein Team bestätigt. Jeder Stempel steht mit Uhrzeit im Verlauf der Karte.'],
    ['Was, wenn der Scan nicht klappt?', R.counterAnswer],
    ['Was passiert bei einem falsch gebuchten Stempel?', R.correctionAnswer],
    ['Was, wenn der Kartenlink verloren geht?', R.lostAnswer],
    ['Ich habe schon Pappkarten.', 'Die kannst du auslaufen lassen. Wer noch eine volle Pappkarte hat, löst sie wie gewohnt ein; neue Kunden starten digital.'],
    E.pageWalletFaq,
  ],
  close: { h2: ['Zeig mir das', 'an meinem Laden.'], lead: 'Wir richten die Demo mit deinem Namen und deiner Prämie ein. Zehn Minuten, gern direkt bei dir im Laden.', subject: 'Demo-Anfrage Barber' },
};

// ── Pizzeria / Imbiss ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const pizzaBrand: BrandState = { ...initialBrand(), style: 'terrakotta' };
export const pizzeria: SubPage = {
  path: '/fuer-pizzerien/',
  title: 'Digitale Stempelkarte für Pizzerien und Imbisse – Loynara',
  description: 'Die zehnte Pizza aufs Haus – ohne Pappkarte und ohne App: Stempel bei jeder bestätigten Abholung oder jedem Besuch, Empfehlungen und ein Überblick über deine Stammgäste.',
  eyebrow: 'Für Pizzerien und Imbisse',
  h1: ['Die zehnte Pizza kennt jeder.', 'Jetzt ohne Pappkarte.'],
  lead: 'Bei jeder bestätigten Abholung oder jedem Besuch vor Ort gibt es einen Stempel. Beim zehnten eine Pizza aufs Haus – oder was du festlegst.',
  hero: card(pizzaBrand, 'Pizzeria da Marco', 'eine Pizza aufs Haus', 8),
  sections: [
    scene({ id: 'ablauf', eyebrow: 'Am Tresen', h2: ['Bestellung abholen.', 'Stempel mitnehmen.'], lead: 'Der Gast zeigt seine Karte beim Bezahlen, dein Team scannt und bestätigt. Bei einer großen Bestellung gibt es mehrere Stempel in einem Schritt.',
      body: `${steps([['Einmal anmelden', E.pageSignupShort], ['Bei jeder Bestellung', 'Karte zeigen, dein Team bestätigt. Erst dann gibt es den Stempel.'], ['Beim zehnten Stempel', 'Die Pizza aufs Haus wird mit einem Tipp eingelöst.']])}<p class="fine">Gezählt wird, was über deinen Tresen geht. Bestellungen über Lieferplattformen laufen nicht über Loynara.</p>`,
      visual: card(pizzaBrand, 'Pizzeria da Marco', 'eine Pizza aufs Haus', 10) }),
    scene({ id: 'empfehlung', tone: 'white', flip: true, eyebrow: 'Empfehlungen', h2: ['Wer eure Pizza liebt,', 'erzählt es weiter.'], lead: 'Dein Stammgast teilt seinen Link mit Familie oder Kollegen. Bei deren erster bestätigter Bestellung gibt es den Bonus, den du festlegst.',
      body: '<p class="fine">Teilen allein bringt nichts. Der Bonus kommt erst mit der ersten bestätigten Bestellung. <a href="/empfehlungen/">So funktionieren Empfehlungen</a></p>',
      visual: refPair(['Sabine', 'Stammgast'], ['Jan', 'neu dabei'], 5) }),
    scene({ id: 'inhaber', eyebrow: 'Für dich als Inhaber', h2: ['Du siehst, wie viele wieder bestellen.', 'Und welche Karten seit Wochen ruhen.'], lead: 'Die Auswertung zählt wiederkehrende Karten. Pro Karte siehst du Stand und die letzte bestätigte Bestellung. Die Karten sind pseudonym.',
      body: '<p class="fine">Eine Liste ruhender Karten, gezielte Nachrichten und Aktionen für ruhige Tage zeigen wir als Ausblick. Sie sind nicht Teil des aktuellen Pilotangebots.</p>',
      visual: ownerToday('Stempel', [['Karte A', '6', 'letzte Bestellung vor 4 Tagen'], ['Karte B', '1', 'neu, geworben'], ['Karte C', '9', 'letzte Bestellung vor 6 Wochen']]) }),
    `<section class="sec sec-white" id="angebot"><div class="wrap offer-grid"><div class="offer-copy"><p class="eyebrow">Was es kostet</p><h2>Ein Preis pro Standort. <em>Keine Provision pro Bestellung.</em></h2><p class="lead">Wir zeigen dir den Ablauf an deinem eigenen Laden und besprechen den Start persönlich.</p></div>${breakEven(18, 'Bestellung')}</div></section>`,
  ],
  faq: [
    ['Brauchen meine Gäste eine App?', E.pageAppAnswer],
    ['Und wenn es freitagabends voll ist?', 'Dann wird beim Bezahlen kurz gescannt und bestätigt, wie beim Abstempeln einer Pappkarte. Bei mehreren Pizzen vergibt dein Team mehrere Stempel in einem Schritt.'],
    ['Funktioniert das mit Lieferando und Co.?', 'Nein. Loynara zählt Bestellungen, die bei dir abgeholt oder vor Ort bezahlt werden. Eine Anbindung an Lieferplattformen oder die Kasse gibt es nicht.'],
    ['Kann jemand schummeln?', 'Einen Stempel gibt es nur, wenn dein Team bestätigt. Jeder Stempel steht mit Uhrzeit im Verlauf der Karte, und Rollen legen fest, wer was darf.'],
    ['Was, wenn der Scan nicht klappt?', R.counterAnswer],
    ['Was passiert bei einem falsch gebuchten Stempel?', R.correctionAnswer],
    ['Was, wenn der Kartenlink verloren geht?', R.lostAnswer],
    ['Ich habe schon Pappkarten.', 'Lass sie auslaufen. Volle Pappkarten löst du wie gewohnt ein; neue Gäste starten digital.'],
  ],
  close: { h2: ['Zeig mir das', 'mit meiner Pizza.'], lead: 'Wir richten die Demo mit deinem Namen und deiner Prämie ein. Zehn Minuten, gern direkt bei dir am Tresen.', subject: 'Demo-Anfrage Pizzeria' },
};

// ── Empfehlungen (Kunden werben Kunden) ──────────────────────────────────────────────────────────────────────────────────────────────
export const referrals: SubPage = {
  path: '/empfehlungen/',
  title: 'Kunden werben Kunden für lokale Geschäfte – Loynara',
  description: 'Empfehlungsprogramm für Cafés, Barber, Pizzerien und Salons: Stammkunden teilen ihren Link, der Bonus kommt erst nach dem ersten bestätigten Besuch des neuen Kunden.',
  eyebrow: 'Kunden werben Kunden',
  h1: ['Dein bester Kunde kennt deinen nächsten.', 'Gib ihm einen Grund, ihn mitzubringen.'],
  lead: 'Jeder Kunde mit Karte kann seinen persönlichen Link teilen. Belohnt wird erst, wenn der neue Kunde wirklich bei dir war und dein Team den Besuch bestätigt hat.',
  hero: `<div id="empfehlung">${refPair(['Lena', 'Stammkundin'], ['Jonas', 'neu dabei'], 7)}</div>`,
  sections: [
    `<section class="sec" id="ablauf"><div class="wrap"><div class="head"><p class="eyebrow">So läuft es</p><h2>Vier Schritte. <em>Belohnt wird nur der letzte.</em></h2></div>${steps([['Link geteilt', 'Lena schickt ihren persönlichen Link, zum Beispiel per WhatsApp.'], ['Karte erstellt', 'Jonas meldet sich über den Link an. Noch kein Bonus.'], ['Erster Besuch bestätigt', 'Jonas kommt vorbei, dein Team bestätigt seinen ersten Besuch.'], ['Bonus verbucht', 'Lena bekommt ihren Bonus, Jonas auf Wunsch auch. Einmal, nicht mehrfach.']])}</div></section>`,
    `<section class="sec sec-white" id="regeln"><div class="wrap offer-grid"><div class="offer-copy"><p class="eyebrow">Fair für dich</p><h2>Du legst den Bonus fest. <em>Und siehst jede Empfehlung.</em></h2><p class="lead">Bonusstempel für den Empfehlenden, für den neuen Kunden oder für beide. Was bei der Anmeldung galt, bleibt für diese Empfehlung gültig – auch wenn du die Regel später änderst.</p></div><div class="price-card"><ul class="checks"><li>Kein Bonus für bloßes Teilen, Öffnen oder Anmelden.</li><li>Der Bonus wird genau einmal gebucht, nach dem ersten bestätigten Besuch.</li><li>Gleiche verifizierte E-Mail-Adressen werden zur Prüfung zurückgestellt.</li><li>In der Übersicht siehst du: angemeldet, wartet auf ersten Besuch, Bonus gutgeschrieben.</li></ul><p class="fine">Karten sind pseudonym. Dass ein neuer Kunde wirklich eine andere Person ist, lässt sich nicht vollständig beweisen. Deshalb zählt nur der bestätigte Besuch.</p></div></div></section>`,
    `<section class="sec" id="branchen"><div class="wrap"><div class="head"><p class="eyebrow">Wo es besonders gut passt</p><h2>Überall, wo Kunden <em>sich gegenseitig fragen.</em></h2><p class="lead">„Wo lässt du dir die Haare schneiden?“ – „Wo holt ihr eure Pizza?“ Genau in diesen Gesprächen entsteht der nächste Kunde.</p></div><ul class="checks"><li><a href="/fuer-barber/">Barbershops</a>: Freunde gehen oft zum selben Barber.</li><li><a href="/fuer-pizzerien/">Pizzerien und Imbisse</a>: Familie und Kollegen bestellen mit.</li><li>Cafés und Salons: Wer zufrieden ist, nimmt jemanden mit.</li></ul></div></section>`,
  ],
  faq: [
    ['Kostet das extra?', `Nein. Empfehlungen gehören zum Pilotangebot für ${price()} pro Monat und Standort.`],
    ['Wie teilen meine Kunden ihren Link?', 'Auf ihrer Karte im Browser gibt es einen persönlichen Link. Den schicken sie wie jeden anderen Link, etwa per WhatsApp.'],
    ['Was, wenn jemand sich selbst empfiehlt?', 'Ein Bonus entsteht erst mit einem Besuch, den dein Team bestätigt. Auffällige Fälle wie dieselbe verifizierte E-Mail-Adresse werden zur Prüfung zurückgestellt, du entscheidest.'],
    ['Kann ich Empfehlungen ausschalten?', 'Ja. Sie sind ausgeschaltet, bis du sie einschaltest, und du kannst sie jederzeit wieder abschalten.'],
    ['Weiß ich, ob eine Empfehlung etwas gebracht hat?', 'Du siehst, wie viele Karten über Empfehlungen entstanden sind und bei wie vielen der erste Besuch bestätigt wurde. Ob jemand auch ohne Empfehlung gekommen wäre, kann niemand wissen.'],
  ],
  close: { h2: ['Probier es', 'an deinem Geschäft aus.'], lead: 'In der Demo spielen wir eine Empfehlung einmal komplett durch – mit deinem Namen und deinem Bonus.', subject: 'Demo-Anfrage Empfehlungen' },
};

export const SUB_PAGES = [barber, pizzeria, referrals] as const;

/** Page body. The shell (head, header, footer) comes from template.ts so every page shares one chrome. */
export function subPageBody(p: SubPage): string {
  const faq = `<section class="sec" id="fragen"><div class="wrap narrow"><div class="faq"><h3>Gut zu wissen</h3>${p.faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div></div></section>`;
  const close = `<section class="sec sec-white" id="anfrage"><div class="wrap"><div class="head"><p class="eyebrow">Demo anfragen</p><h2>${p.close.h2[0]} <em>${p.close.h2[1]}</em></h2><p class="lead">${p.close.lead}</p></div><div class="ctas"><a class="btn btn-primary" href="${mailto(p.close.subject)}">Demo anfragen ${arrow}</a><a class="btn btn-ghost" href="/">Zur Startseite</a></div><p class="fine">Die Anfrage öffnet dein E-Mail-Programm. Gesendet wird sie erst dort.</p></div></section>`;
  return `<main id="inhalt"><section class="hero" id="hero"><div class="wrap hero-grid"><div class="hero-copy"><p class="eyebrow">${p.eyebrow}</p><h1>${p.h1[0]}<br><em>${p.h1[1]}</em></h1><p class="lead">${p.lead}</p><div class="ctas"><a class="btn btn-primary" href="#anfrage">Demo anfragen</a><a class="btn btn-ghost" href="#ablauf">So funktioniert’s</a></div><p class="facts"><span>Ohne App für deine Kunden</span><span>${E.fact}</span><span>${price()} / Monat / Standort</span></p></div><figure class="hero-scene hero-scene-sub" aria-label="Beispieldarstellung">${p.hero}</figure></div></section>${p.sections.join('')}${faq}${close}</main>`;
}
