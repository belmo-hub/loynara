/** Design-direction prototypes. Not production pages: noindex, not in the sitemap, built only with MARKETING_CONCEPTS=true. */
import { SITE } from '../src/site.js';
import { STYLES, type StyleKey } from '../src/brand.js';
import { EXAMPLE, compute, euro, signedEuro, ratioText, type FieldKey } from '../src/calc.js';
import { cardHtml, standSvg, walletHtml, calcField, ownerPanels, bars, message, REF_FLOW, OUTLOOK, X } from '../src/concept-parts.js';

const s0 = compute(EXAMPLE, SITE.price.amount);
const price = euro(SITE.price.amount);
const mail = `mailto:${SITE.supportEmail}?subject=${encodeURIComponent('Demo-Anfrage Loynara')}`;
const KEYS: FieldKey[] = ['visits', 'basket', 'days', 'gain'];
const SCOPE = ['Karte mit Stempeln oder Punkten, Prämien', 'NFC- und QR-Einstieg, Teambestätigung', 'Empfehlungen, Kundenübersicht, Auswertung', 'Rollen und mehrere Standorte'];
const OUTLOOK_OFFER = 'Aufsteller und NFC-Schild, Wallet-Karte, Logo-Darstellung, Kampagnen und Nachrichten';
const DISCLAIMER = '<b>Rechenbeispiel, keine Umsatzprognose.</b> Wareneinsatz, Prämien, zusätzliche Arbeitskosten und Steuern sind nicht berücksichtigt.';

export const CONCEPTS = [
  { slug: 'concept-a', short: 'A', name: 'Fidelix-klar', line: 'Eine Spalte, breite Karten, ein Gedanke pro Block – die ruhigste und direkteste Variante.' },
  { slug: 'concept-b', short: 'B', name: 'Editorial Product', line: 'Große Produktobjekte, viel Raum, kaum Rahmen – Typografie und Objekte tragen die Seite.' },
  { slug: 'concept-c', short: 'C', name: 'Hybrid', line: 'Klare Mobil-Struktur mit Loynaras Grün/Creme-Charakter und zwei interaktiven Bühnen.' },
] as const;

const head = (title: string, body: string) => `<!doctype html><html lang="de" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Loynara – ${title}</title><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${SITE.origin}/"><link rel="preload" href="/assets/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="icon" href="/assets/loynara-mark.svg" type="image/svg+xml"><link rel="stylesheet" href="/concepts.css"><script type="module" src="/assets/concepts.js"></script></head><body class="${body}">`;
const logo = '<img src="/assets/loynara-mark.svg" width="30" height="30" alt="">';
const topbar = (c: typeof CONCEPTS[number]) => `<aside class="proto" aria-label="Prototyp-Hinweis"><a href="/concepts/">Prototyp ${c.short} · ${c.name}</a><span>Keine veröffentlichte Seite</span></aside><header class="top"><div class="wrap bar"><a class="logo" href="#top">${logo}<span>Loynara</span></a><a class="btn btn-small" href="#kontakt">Demo anfragen</a></div></header>`;
const foot = `<footer class="foot"><div class="wrap foot-bar"><span>${logo}Loynara</span><nav aria-label="Rechtliches"><a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a><a href="/concepts/">Alle Konzepte</a></nav></div></footer>`;
const end = '</body></html>';

const seg = (panel: string, label: string, items: Array<[string, string]>, cls = 'seg') => `<div class="${cls}" role="tablist" aria-label="${label}" data-tabs="${panel}">${items.map(([v, t], i) => `<button type="button" role="tab" id="${panel}-${v}" data-view="${v}" aria-selected="${i === 0}" aria-controls="${panel}" tabindex="${i ? -1 : 0}">${t}</button>`).join('')}</div>`;
const swatches = () => `<div class="swatch-row"><p class="swatch-label">Markenfarbe <b data-brand-label>${STYLES.wald.label}</b></p><div class="swatches">${(Object.keys(STYLES) as StyleKey[]).map(k => `<button type="button" class="swatch sw-${k}" data-brand-pick="${k}" aria-label="${STYLES[k].label}" aria-pressed="${k === 'wald'}"></button>`).join('')}</div></div>`;
const fields = (id: string) => KEYS.map(k => calcField(k, EXAMPLE[k], id, k === 'visits' ? 'Einkäufe, nicht verschiedene Personen.' : k === 'gain' ? 'Deine Annahme – kein Erfahrungswert von Loynara.' : '')).join('');
const chartFig = (id: string) => `<figure class="chartfig"><figcaption class="legend"><span><i class="sw-line base"></i>Ohne angenommene Steigerung</span><span><i class="sw-line scen"></i>Mit deiner angenommenen Steigerung</span></figcaption><svg data-chart viewBox="0 0 360 250" role="img" aria-label="Kumulierter Umsatz über zwölf Monate, mit und ohne angenommene Steigerung. Der Abstand ist der Zusatzumsatz vor Gebühr. Werte als Tabelle darunter."></svg><details class="ctable"><summary>Werte als Tabelle</summary><div data-table></div></details></figure>`;
const ratio = `<p class="ratio">Zusatzumsatz im Vergleich zur Monatsgebühr: <b data-out="ratio">${ratioText(s0.ratio)}</b>. Ein Vergleich von Umsatz und Gebühr – kein Gewinn und keine Rendite.</p>`;
const empty = '<p class="calc-empty">Trage in allen vier Feldern gültige Zahlen ein, um das Beispiel zu sehen.</p>';
const checks = (cls = 'checks') => `<ul class="${cls}">${SCOPE.map(x => `<li>${x}</li>`).join('')}</ul>`;
const live = '<p class="sr-only" data-live role="status"></p>';
const ownerShows = (prefix: string) => (['overview', 'quiet', 'win'] as const).map((v, i) => `<div class="ow ow-${v}" data-show="${v}"${i ? ' hidden' : ''}>${ownerPanels[v]}</div>`).join('');
const contact = (cls: string, h: string) => `<section class="${cls}" id="kontakt"><div class="wrap"><h2>${h}</h2><p class="lead">Wir zeigen dir Loynara am Beispiel deines Geschäfts.</p><a class="btn btn-light" href="${mail}">E-Mail an ${SITE.supportEmail}</a><p class="fine">Öffnet dein E-Mail-Programm. Gesendet wird erst dort.</p><p class="fine">Schon dabei? <a href="${SITE.loginUrl}">Zur Anmeldung</a></p></div></section>`;

// ================================================================================================ A — Fidelix-klar
export function conceptA(): string {
  const c = CONCEPTS[0];
  return `${head('Konzept A', 'ca')}${topbar(c)}<main id="top">
<section class="sec hero"><div class="wrap split"><div class="copy"><p class="eyebrow">Für Cafés, Salons und Geschäfte mit Stammkunden</p><h1>Ein guter Besuch. Ein Grund, wiederzukommen.</h1><p class="lead">Digitale Treuekarten, Prämien und Empfehlungen – in einem System für dein Geschäft.</p><div class="ctas"><a class="btn btn-primary" href="#kontakt">Demo anfragen</a><a class="btn btn-ghost" href="#ablauf">So funktioniert’s</a></div></div><figure class="visual">${cardHtml({ balance: 9, status: 'Noch ein Besuch' })}<figcaption class="caption">Beispielkarte · öffnet sich im Browser, ohne App</figcaption></figure></div></section>

<section class="sec alt" id="ablauf"><div class="wrap"><div class="head"><p class="eyebrow">Ablauf</p><h2>Kunde öffnet. Team bestätigt. Du siehst es.</h2><p class="lead">Ein Stempel entsteht erst, wenn dein Team den Besuch bestätigt.</p></div>
<div class="steps" data-visit="single">
<div class="step"><p class="step-n">1 · Kunde</p><h3>Karte per NFC oder QR öffnen</h3><div data-card="lg">${cardHtml({ balance: 8, status: 'Noch 2 Besuche' })}</div></div>
<div class="step"><p class="step-n">2 · Kasse</p><h3>Dein Team bestätigt</h3><div class="card till"><p data-bind="caption">Neue Anfrage an der Kasse: Beispielkarte 4217.</p><button type="button" class="btn btn-primary btn-block" data-visit-act>Besuch bestätigen</button><button type="button" class="text-btn" data-visit-reset hidden>Beispiel zurücksetzen</button></div></div>
<div class="step"><p class="step-n">3 · Inhaber</p><h3>Du siehst, was passiert</h3><div class="card"><p class="big-num"><b data-bind="visits">0</b><span data-bind="visits-label">bestätigte Besuche heute</span></p><p class="cap">Beispieldaten</p></div></div>${live}</div></div></section>

<section class="sec" id="empfehlung"><div class="wrap split top"><div class="head"><p class="eyebrow">Empfehlungen</p><h2>Stammkunden bringen den nächsten Kunden.</h2><p class="lead">Belohnt wird erst der erste bestätigte Besuch des Freundes – nicht das Teilen.</p></div><ol class="card tl">${REF_FLOW.map(([t, d], i) => `<li${i === 4 ? ' class="win"' : ''}><b>${t}</b><span>${d}</span></li>`).join('')}</ol></div></section>

<section class="sec alt" id="inhaber"><div class="wrap split top"><div class="head"><p class="eyebrow">Für dich als Inhaber</p><h2>Nicht nur sehen, wer kommt.</h2><p class="lead">Ein Moment, eine Idee: was passiert ist, wann es ruhig ist, wer länger fehlt.</p></div>
<div class="owner">${seg('a-owner', 'Inhaber-Momente', [['overview', 'Überblick'], ['quiet', 'Ruhige Zeiten'], ['win', 'Zurückholen']])}<div class="card owner-panel" id="a-owner" role="tabpanel" aria-labelledby="a-owner-overview" data-view="overview">${ownerShows('a')}</div></div></div></section>

<section class="sec" id="gestaltung"><div class="wrap" data-brand-root data-brand="wald"><div class="head"><p class="eyebrow">Gestaltung</p><h2>Dein Geschäft. Wiedererkennbar.</h2><p class="lead">Eine Farbe für Aufsteller, Karte und Wallet-Vorschau.</p></div>${swatches()}
<div class="trio"><figure class="obj obj-stand">${standSvg()}<figcaption><b>Aufsteller am Tresen</b>Gestaltungsbeispiel</figcaption></figure><figure class="obj">${cardHtml({ balance: 8, status: 'Noch 2 Besuche', size: 'md' })}<figcaption><b>Karte im Browser</b>Ohne App für deine Kunden</figcaption></figure><figure class="obj">${walletHtml()}<figcaption><b>Wallet-Vorschau</b>Ausblick, gesondert zu vereinbaren</figcaption></figure></div>
<p class="note">Farben und Prämie stellst du heute ein. Aufsteller, Logo-Darstellung und Wallet-Karte sind Gestaltungsbeispiel und Ausblick – nichts wird hochgeladen oder gespeichert.</p></div></section>

<section class="sec alt" id="rechner"><div class="wrap"><div class="head"><p class="eyebrow">Rechenbeispiel · Für einen Standort</p><h2>Was wäre ein zusätzlicher Besuch wert?</h2><p class="lead">Deine Zahlen, deine Annahme.</p></div>
<div class="calc" data-calc data-autosize><div class="card inputs"><div class="inputs-head"><h3>Deine Zahlen</h3><button type="button" class="text-btn" data-calc-reset>Beispielwerte</button></div>${fields('a')}</div>
<div class="result"><p class="res-label">Zusätzlicher Monatsumsatz im Beispiel</p><p class="res-big" data-out="additional">${euro(s0.additional)}</p><dl class="rows"><div><dt>Loynara</dt><dd><span data-out="fee">${price}</span> / Monat</dd></div><div><dt>Differenz nach Gebühr</dt><dd data-out="difference">${signedEuro(s0.difference)}</dd></div><div><dt>Auf zwölf Monate</dt><dd data-out="annualised">${signedEuro(s0.annualised)}</dd></div></dl><p class="res-note">${DISCLAIMER}</p>${empty}</div>
<details class="card more"><summary>Verlauf über zwölf Monate</summary>${chartFig('a')}${ratio}</details></div></div></section>

<section class="sec" id="preis"><div class="wrap"><div class="card price"><p class="eyebrow">Pilotangebot</p><p class="price-big"><b>${price}</b><span>/ ${SITE.price.unit}</span></p><p class="price-note">${SITE.price.note}</p>${checks()}<a class="btn btn-primary btn-block" href="#kontakt">Demo anfragen</a><p class="fine">Vorläufiger Einstiegspreis. Konditionen besprechen wir vor dem Start persönlich.</p></div><p class="outlook"><b>Gezeigter Ausblick · gesondert zu vereinbaren:</b> ${OUTLOOK_OFFER}.</p></div></section>
${contact('sec final', 'Gib dem nächsten Besuch einen Grund.')}</main>${foot}${end}`;
}

// ================================================================================================ B — Editorial Product
export function conceptB(): string {
  const c = CONCEPTS[1];
  return `${head('Konzept B', 'cb')}${topbar(c)}<main id="top">
<section class="hero"><div class="wrap"><p class="eyebrow">Digitale Kundenbindung für lokale Geschäfte</p><h1>Ein guter Besuch.<br><em>Ein Grund, wiederzukommen.</em></h1><p class="lead">Treuekarte, Prämien und Empfehlungen – ohne App für deine Kunden.</p><div class="ctas"><a class="btn btn-primary" href="#kontakt">Demo anfragen</a><a class="text-link" href="#besuch">Ansehen ↓</a></div></div>
<div class="field"><figure class="comp" aria-label="Beispieldarstellung: Aufsteller am Tresen und die Kundenkarte im Browser"><div class="comp-stand">${standSvg()}</div><div class="phone">${cardHtml({ balance: 9, status: 'Noch ein Besuch' })}<p class="ph-line">✓ Stempel erhalten</p></div></figure></div></section>

<section class="sec" id="besuch"><div class="wrap story" data-visit="cycle"><div class="story-head"><p class="eyebrow">Am Tresen</p><h2>Ein Besuch.<br><em>Ein Stempel.</em></h2></div><div class="story-obj"><div class="phone"><div data-card="lg">${cardHtml({ balance: 8, status: 'Noch 2 Besuche' })}</div></div></div><div class="story-body"><p class="lead" data-bind="caption">Dein Kunde tippt das Schild an oder scannt den QR-Code.</p><button type="button" class="btn btn-primary" data-visit-act>Karte öffnen</button><p class="owner-line">Im Überblick des Inhabers: <b data-bind="summary">0 bestätigte Besuche · 0 Prämien eingelöst</b></p>${live}</div></div></section>

<section class="sec tint" id="empfehlung"><div class="wrap ref" data-ref><div class="center-head"><p class="eyebrow">Empfehlungen</p><h2>Ein Stammkunde.<br><em>Ein neuer Kunde.</em></h2></div>
<div class="tokens"><div class="token" data-token="a"><small>Kunde A</small><b><span data-bind="a">7</span><i>/10</i></b><span class="tk-note">Stammkunde</span></div><span class="tk-link" aria-hidden="true"></span><div class="token" data-token="b"><small>Freund B</small><b><span data-bind="b">–</span><i>/10</i></b><span class="tk-note">neu dabei</span></div></div>
<ol class="ticks">${['Geteilt', 'Geöffnet', 'Angemeldet', 'Erster Besuch · Bonus'].map(t => `<li data-ref-step>${t}</li>`).join('')}</ol><p class="lead" data-bind="caption">Kunde A ist Stammkunde: 7 von 10 Stempeln.</p><button type="button" class="btn btn-primary" data-ref-act>Link teilen</button><p class="cap">Teilen oder Öffnen allein bringt keinen Bonus – erst der erste bestätigte Besuch des Freundes.</p>${live}</div></section>

<section class="sec" id="inhaber"><div class="wrap owner"><div class="owner-head"><p class="eyebrow">Für dich als Inhaber</p><h2>Dienstag, 15:30.<br><em>Heute darf mehr los sein.</em></h2><p class="lead">Wann es ruhig ist – und was du dann anbieten könntest.</p></div><figure class="owner-vis"><p class="cap">${OUTLOOK}</p>${bars()}${message(X.quiet.message)}</figure>
<ul class="caps"><li><b>Überblick</b><span>Bestätigte Besuche, Prämien und Empfehlungen – im Pilotangebot.</span></li><li><b>Ruhige Zeiten</b><span>Ausblick</span></li><li><b>Zurückholen</b><span>Ausblick</span></li></ul></div></section>

<section class="brand" id="gestaltung" data-brand-root data-brand="wald"><div class="wrap center-head"><p class="eyebrow">Gestaltung</p><h2>Dein Tresen.<br><em>Deine Farbe.</em></h2></div><div class="stand-field"><div class="stand-hero">${standSvg()}</div></div><div class="wrap">${swatches()}<div class="pair"><div class="pair-card">${cardHtml({ balance: 8, status: 'Noch 2 Besuche', size: 'md' })}</div><div class="pair-wallet">${walletHtml()}</div></div><p class="caption">Aufsteller und Karte: Gestaltungsbeispiel. Wallet-Vorschau: Ausblick. Nichts wird hochgeladen oder gespeichert.</p></div></section>

<section class="sec" id="rechner"><div class="wrap calc" data-calc data-autosize><div class="calc-head"><p class="eyebrow">Rechenbeispiel · Für einen Standort</p><h2>Was wäre ein zusätzlicher <em>Besuch</em> wert?</h2></div><div class="inputs">${fields('b')}<button type="button" class="text-btn" data-calc-reset>Beispielwerte</button></div>
<div class="result"><p class="res-big" data-out="additional">${euro(s0.additional)}</p><p class="res-label">zusätzlicher Monatsumsatz im Beispiel</p><p class="res-line">Abzüglich <span data-out="fee">${price}</span> Gebühr: <b data-out="difference">${signedEuro(s0.difference)}</b> im Monat, <b data-out="annualised">${signedEuro(s0.annualised)}</b> auf zwölf Monate hochgerechnet.</p><p class="res-note">${DISCLAIMER}</p>${empty}${chartFig('b')}${ratio}</div></div></section>

<section class="sec price" id="preis"><div class="wrap"><p class="eyebrow">Pilotangebot</p><p class="price-giant">${price}</p><p class="price-unit">pro Monat und Standort</p><p class="price-note">${SITE.price.note}</p>${checks('inline')}<a class="btn btn-primary" href="#kontakt">Demo anfragen</a><p class="fine">Vorläufiger Einstiegspreis. Konditionen besprechen wir vor dem Start persönlich.</p><p class="outlook">Gezeigter Ausblick, gesondert zu vereinbaren: ${OUTLOOK_OFFER}.</p></div></section>
${contact('final', 'Gib dem nächsten Besuch <em>einen Grund.</em>')}</main>${foot}${end}`;
}

// ================================================================================================ C — Hybrid
export function conceptC(): string {
  const c = CONCEPTS[2];
  const views: Array<[string, string, string, string]> = [
    ['visit', 'Dein Team bestätigt jeden Besuch.', '', ''],
    ['reward', 'Voller Stand, Prämie, Einlösung.', `Bei zehn Stempeln wartet ${X.reward}. Dein Team löst die Prämie ein – genau einmal.`, cardHtml({ balance: 10, status: 'Prämie bereit' }) + '<p class="ph-line">✓ Prämie an der Kasse einlösen</p>'],
    ['refer', 'Freund bringt Freund.', 'Der Bonus kommt mit dem ersten bestätigten Besuch des Freundes – nicht mit dem Teilen.', cardHtml({ balance: 8, status: '+1 Empfehlungsbonus' }) + '<p class="ph-line">✓ Freund B: erster Besuch bestätigt</p>'],
    ['overview', 'Du siehst, was passiert.', 'Bestätigte Besuche, Prämien und Empfehlungen – ohne Papierkarten zu zählen.', '<div class="ph-owner"><p class="ph-title">Überblick · diese Woche</p><p><b>12</b>bestätigte Besuche</p><p><b>3</b>Prämien eingelöst</p><p><b>2</b>Empfehlungen qualifiziert</p><p class="cap">Beispieldaten</p></div>'],
  ];
  return `${head('Konzept C', 'cc')}${topbar(c)}<main id="top">
<section class="hero"><div class="wrap split"><div class="copy"><p class="eyebrow">Wiederkommen belohnen. Weiterempfehlen leicht machen.</p><h1>Ein guter Besuch.<br><em>Ein Grund, wiederzukommen.</em></h1><p class="lead">Digitale Treuekarten, Prämien und Empfehlungen – verbunden in einem System für dein Geschäft.</p><div class="ctas"><a class="btn btn-primary" href="#kontakt">Demo anfragen</a><a class="btn btn-ghost" href="#ablauf">Ablauf ansehen</a></div></div><figure class="comp" aria-label="Beispieldarstellung: Aufsteller, Kundenkarte und die Bestätigung durch das Team"><div class="comp-stand">${standSvg()}</div><div class="phone">${cardHtml({ balance: 9, status: 'Noch ein Besuch' })}</div><figcaption class="float">✓ Besuch bestätigt · von deinem Team</figcaption></figure></div></section>

<section class="sec" id="ablauf"><div class="wrap"><div class="head"><p class="eyebrow">Ablauf</p><h2>Aus einem Besuch wird eine <em>Beziehung.</em></h2></div>
${seg('c-stage', 'Ablauf', [['visit', 'Besuch'], ['reward', 'Prämie'], ['refer', 'Empfehlung'], ['overview', 'Überblick']])}
<div class="stage" id="c-stage" role="tabpanel" aria-labelledby="c-stage-visit" data-view="visit" data-visit="single"><div class="phone">${views.map(([v, , , screen], i) => `<div data-show="${v}"${i ? ' hidden' : ''}>${v === 'visit' ? `<div data-card="lg">${cardHtml({ balance: 8, status: 'Noch 2 Besuche' })}</div>` : screen}</div>`).join('')}</div>
<div class="stage-text">${views.map(([v, h, p], i) => `<div data-show="${v}"${i ? ' hidden' : ''}><h3>${h}</h3>${v === 'visit' ? `<p data-bind="caption">Neue Anfrage an der Kasse: Beispielkarte 4217.</p><div class="ctas"><button type="button" class="btn btn-primary" data-visit-act>Besuch bestätigen</button><button type="button" class="text-btn" data-visit-reset hidden>Zurücksetzen</button></div>` : `<p>${p}</p>`}</div>`).join('')}<p class="cap">Interaktive Demo · Beispieldaten</p></div>${live}</div></div></section>

<section class="sec alt" id="empfehlung"><div class="wrap"><div class="head"><p class="eyebrow">Empfehlungen</p><h2>Belohne nicht nur den Besuch. <em>Auch die Empfehlung.</em></h2></div><ol class="steps">${[['Link geteilt', 'Kunde A teilt seinen persönlichen Link.'], ['Freund meldet sich an', 'Freund B erstellt seine Karte.'], ['Erster Besuch bestätigt', 'Dein Team bestätigt den Besuch an der Kasse.'], ['Bonus verbucht', '+1 Stempel für Kunde A – genau einmal.']].map(([t, d], i) => `<li${i === 3 ? ' class="win"' : ''}><b>${t}</b><span>${d}</span></li>`).join('')}</ol><p class="cap">Teilen oder Öffnen allein bringt keinen Bonus. Auffällige Fälle werden zur Prüfung zurückgestellt.</p></div></section>

<section class="sec dark" id="inhaber"><div class="wrap"><div class="head"><p class="eyebrow">Für dich als Inhaber</p><h2>Nicht nur sehen, wer kommt. <em>Einen Anlass schaffen.</em></h2></div>${seg('c-owner', 'Inhaber-Momente', [['overview', 'Überblick'], ['quiet', 'Ruhige Zeiten'], ['win', 'Zurückholen']], 'seg seg-dark')}<div class="owner-panel" id="c-owner" role="tabpanel" aria-labelledby="c-owner-overview" data-view="overview">${ownerShows('c')}</div></div></section>

<section class="sec" id="gestaltung"><div class="wrap" data-brand-root data-brand="wald"><div class="head"><p class="eyebrow">Gestaltung</p><h2>Dein Geschäft. Wiedererkennbar bis zur nächsten <em>Prämie.</em></h2></div>
<div class="studio"><div class="studio-controls">${seg('c-studio', 'Ansicht', [['stand', 'Aufsteller'], ['card', 'Karte'], ['wallet', 'Wallet']])}${swatches()}</div>
<div class="studio-view" id="c-studio" role="tabpanel" aria-labelledby="c-studio-stand" data-view="stand"><figure data-show="stand">${standSvg()}<figcaption>Aufsteller am Tresen · Gestaltungsbeispiel</figcaption></figure><figure data-show="card" hidden>${cardHtml({ balance: 8, status: 'Noch 2 Besuche' })}<figcaption>Karte im Browser · ohne App</figcaption></figure><figure data-show="wallet" hidden>${walletHtml()}<figcaption>Wallet-Vorschau · Ausblick</figcaption></figure></div></div></div></section>

<section class="sec alt" id="rechner"><div class="wrap"><div class="head"><p class="eyebrow">Rechenbeispiel · Für einen Standort</p><h2>Was würde ein zusätzlicher Anlass zum Wiederkommen bedeuten?</h2></div>
<div class="calc" data-calc><div class="card inputs"><div class="inputs-head"><h3>Deine Zahlen</h3><button type="button" class="text-btn" data-calc-reset>Beispielwerte</button></div>${fields('c')}</div>
<div class="result"><p class="res-label">Zusätzlicher Monatsumsatz im Beispiel</p><p class="res-big" data-out="additional">${euro(s0.additional)}</p><dl class="rows"><div><dt>Monatsgebühr</dt><dd data-out="fee">${price}</dd></div><div><dt>Differenz nach Gebühr</dt><dd data-out="difference">${signedEuro(s0.difference)}</dd></div><div><dt>Auf zwölf Monate</dt><dd data-out="annualised">${signedEuro(s0.annualised)}</dd></div></dl><p class="res-note">${DISCLAIMER}</p>${empty}</div>
<div class="card graph">${chartFig('c')}${ratio}</div></div></div></section>

<section class="sec" id="preis"><div class="wrap"><div class="offer"><div class="offer-main"><p class="eyebrow">Pilotangebot</p><p class="price-big"><b>${price}</b><span>/ ${SITE.price.unit}</span></p><p class="price-note">${SITE.price.note}</p><a class="btn btn-light" href="#kontakt">Demo anfragen</a></div><div class="offer-scope">${checks()}<p class="fine">Vorläufiger Einstiegspreis. Konditionen besprechen wir vor dem Start persönlich.</p></div></div><p class="outlook"><b>Gezeigter Ausblick · gesondert zu vereinbaren:</b> ${OUTLOOK_OFFER}.</p></div></section>
${contact('sec final', 'Gib dem nächsten Besuch einen Grund. <em>Und der nächsten Empfehlung einen Weg.</em>')}</main>${foot}${end}`;
}

export function conceptIndex(): string {
  return `${head('Gestaltungskonzepte', 'cx')}<main class="wrap idx"><p class="eyebrow">Interne Vorschau · nicht veröffentlicht</p><h1>Drei Richtungen für Loynara</h1><p class="lead">Gleiche Inhalte, gleiche Logik, gleicher Preis – unterschiedliche Gestaltung. Bitte auf dem iPhone und am Desktop ansehen.</p><ul class="idx-list">${CONCEPTS.map(c => `<li><a href="/${c.slug}/"><span class="idx-letter">${c.short}</span><span><b>${c.name}</b><span>${c.line}</span></span></a></li>`).join('')}</ul><p class="fine">Die aktuelle Seite zum Vergleich: <a href="/">Startseite</a></p></main>${end}`;
}
export const brandCss = () => (Object.keys(STYLES) as StyleKey[]).map(k => { const s = STYLES[k]; return `[data-brand="${k}"]{--b-dark:${s.dark};--b-mid:${s.mid};--b-accent:${s.accent};--b-soft:${s.soft}}.sw-${k}{--sw:${s.dark}}`; }).join('\n');
