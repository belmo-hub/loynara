/** Marketing page (Concept D): static HTML, German only. All interaction lives in src/d.ts; this file only renders the starting state. */
import { ENTRY_COPY as E, RECOVERY_COPY as R } from './src/claims.js';
import { SITE, industries, industryKeys } from './src/site.js';
import { initialBrand } from './src/brand.js';
import { EXAMPLE, compute, series, euro, signedEuro, ratioText, niceScale } from './src/calc.js';
import { plot, tableHtml, COMPACT } from './src/chart.js';
import { calcField, statusFor, studioControls } from './src/final-parts.js';
import { standObj, phone, browserScreen, visitScreen, visitStep, VISIT_STEPS, refVisual, REF_STEPS_D, ownerViewsD } from './src/d-parts.js';
import { initialDemo } from './src/demo.js';
import { initialRef } from './src/ref.js';
import { subPageBody, type SubPage } from './src/pages.js';

const TITLE = 'Loynara – Digitale Kundenkarte für lokale Geschäfte';
const DESCRIPTION = 'Digitale Kundenbindung für lokale Geschäfte: Kunden sammeln Prämien ohne App, dein Team bestätigt jeden Besuch – und Stammkunden können den nächsten Kunden mitbringen.';
const SOCIAL_TITLE = 'Loynara – Aus Kunden werden Stammkunden';
const SOCIAL_DESCRIPTION = `Digitale Kundenkarte für lokale Geschäfte. ${E.social} – dein Team bestätigt jeden Besuch.`;
const mark = '<img src="/assets/loynara-mark.svg" width="32" height="32" alt=""><span class="wordmark">Loynara</span>';
const arrow = '<span aria-hidden="true">→</span>';
const mailto = (subject: string) => `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(subject)}`;
const price = `${SITE.price.amount} €`;
export const escapeText = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const head = (opts: { title: string; description: string; path: string; robots: string; social?: boolean }) => `<!doctype html><html lang="de" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#F6F3EC"><title>${opts.title}</title><meta name="description" content="${opts.description}"><meta name="robots" content="${opts.robots}"><link rel="canonical" href="${SITE.origin}${opts.path}"><link rel="icon" href="/assets/loynara-mark.svg" type="image/svg+xml"><meta property="og:type" content="website"><meta property="og:locale" content="de_DE"><meta property="og:site_name" content="Loynara"><meta property="og:title" content="${opts.social ? SOCIAL_TITLE : opts.title}"><meta property="og:description" content="${opts.social ? SOCIAL_DESCRIPTION : opts.description}"><meta property="og:url" content="${SITE.origin}${opts.path}"><meta property="og:image" content="${SITE.origin}/assets/social-preview.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${opts.social ? SOCIAL_TITLE : opts.title}"><meta name="twitter:description" content="${opts.social ? SOCIAL_DESCRIPTION : opts.description}"><meta name="twitter:image" content="${SITE.origin}/assets/social-preview.png"><link rel="preload" href="/assets/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/assets/fonts/fraunces-latin-italic.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css">`;

export const header = (home: boolean) => {
  const base = home ? '' : '/';
  return `<a class="skip" href="#inhalt">Zum Inhalt springen</a><header class="top"><div class="wrap bar"><a class="logo" href="/" aria-label="Loynara Startseite">${mark}</a><nav class="mainnav" aria-label="Hauptnavigation"><a href="${base}#ablauf">Ablauf</a><a href="${base}#empfehlung">Empfehlungen</a><a href="${base}#gestaltung">Gestaltung</a><a href="${base}#inhaber">Inhaber</a><a href="${base}#rechner">Rechner</a><a href="${base}#angebot">Preis</a></nav><div class="bar-actions"><a class="login" href="${SITE.loginUrl}">Anmelden</a><a class="btn btn-small" href="${base}#anfrage">Demo anfragen</a></div></div></header>`;
};
export const footer = `<footer class="foot"><div class="wrap"><div class="foot-top"><a class="logo" href="/" aria-label="Loynara Startseite">${mark}</a><p>Wiederkommen belohnen. Weiterempfehlen leicht machen.</p></div><nav class="foot-links" aria-label="Branchen und Themen"><a href="/fuer-barber/">Für Barber</a><a href="/fuer-pizzerien/">Für Pizzerien</a><a href="/empfehlungen/">Kunden werben Kunden</a></nav><nav class="foot-links" aria-label="Rechtliches und Kontakt"><a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a><a href="${SITE.loginUrl}">Anmelden</a><a href="mailto:${SITE.supportEmail}">${SITE.supportEmail}</a></nav><p class="foot-note">© Loynara</p></div></footer>`;

const faq: Array<[string, string]> = [
  ['Müssen meine Kunden eine App installieren?', E.appAnswer],
  ['Was macht mein Team an der Kasse?', R.counterAnswer],
  E.nfcFaq,
  ['Wann wird eine Empfehlung belohnt?', 'Ein Freund meldet sich über den Link des Empfehlenden an. Erst wenn dein Team seinen ersten Besuch bestätigt, wird der Bonus verbucht – für den Empfehlenden, auf Wunsch auch für den Freund. Bloßes Teilen oder Öffnen bringt nichts; auffällige Fälle, etwa dieselbe verifizierte E-Mail-Adresse, werden zur Prüfung zurückgestellt.'],
  ['Was passiert, wenn jemand seine Karte nicht mehr findet?', R.lostAnswer],
  ['Was passiert bei einem falsch gebuchten Stempel?', R.correctionAnswer],
  ['Was gehört zum Pilotangebot – und wie geht es weiter?', `Karte, Prämien, ${E.pilotEntry}, Bestätigung durch dein Team, Empfehlungen, Kundenübersicht, Auswertung, Rollen und mehrere Standorte. ${E.pilotOutlook} zeigen wir als Ausblick und vereinbaren sie gesondert. Nach deiner Anfrage melden wir uns, zeigen dir den Ablauf und besprechen Konditionen.`],
];

const brand0 = initialBrand();
const s0 = compute(EXAMPLE, SITE.price.amount);
const pts0 = series(s0), sc0 = niceScale(pts0[12].scenario);
const demo0 = initialDemo('returning'), ref0 = initialRef();
const INCLUDED = ['Digitale Treuekarte mit Stempeln oder Punkten', 'Prämien und Einlösung', E.included, 'Bestätigung durch dein Team, mit Rollen', 'Empfehlungen', 'Kundenübersicht und Auswertung', 'Mehrere Standorte'];
const seg = (id: string, label: string, items: Array<[string, string]>, cls = 'seg') => `<div class="${cls}" role="tablist" aria-label="${label}" data-tabs="${id}">${items.map(([v, t], i) => `<button type="button" role="tab" id="${id}-${v}" data-view="${v}" aria-selected="${i === 0}" aria-controls="${id}" tabindex="${i ? -1 : 0}">${t}</button>`).join('')}</div>`;
const steps = (cls: string, labels: string[], lit: number) => `<ol class="steps ${cls}">${labels.map((t, i) => `<li${i < lit ? ' class="done"' : i === lit ? ' class="now"' : ''}>${t}</li>`).join('')}</ol>`;

export function homePage(): string {
  return `${head({ title: TITLE, description: DESCRIPTION, path: '/', robots: 'index,follow', social: true })}<script type="module" src="/assets/app.js"></script></head>
<body>${header(true)}
<main id="inhalt">

<section class="hero" id="hero"><div class="wrap hero-grid"><div class="hero-copy"><p class="eyebrow">Kundenbindung für lokale Geschäfte</p><h1>Ein guter Besuch.<br><em>Ein Grund, wiederzukommen.</em></h1><p class="lead">Behalte die Kunden, die du gewonnen hast. Bring sie zurück. Lass sie die nächsten mitbringen.</p><div class="ctas"><a class="btn btn-primary" href="#anfrage">Demo anfragen</a><a class="btn btn-ghost" href="#ablauf">So funktioniert’s</a></div><p class="facts"><span>Ohne App für deine Kunden</span><span>${E.fact}</span><span>${price} / Monat / Standort</span></p></div>
<figure class="hero-scene" aria-label="Beispieldarstellung: Aufsteller am Tresen und die Kundenkarte auf dem Handy, gerade vom Team bestätigt."><div class="scene-floor" aria-hidden="true"></div><div class="scene-stand">${standObj(brand0)}</div>${phone(browserScreen(brand0, 9, statusFor(9)), 'phone-hero')}<figcaption class="cue"><b>+1</b><span>Stempel · vom Team bestätigt</span></figcaption></figure></div></section>

<section class="roles" aria-label="Wer was tut"><div class="wrap roles-grid"><div><b>Kunde</b><span>${E.roleCustomer}</span></div><div><b>Team</b><span>Bestätigt den Besuch mit einem Tipp.</span></div><div><b>Inhaber</b><span>Sieht, wer wiederkommt – Stand und Verlauf jeder Karte.</span></div></div></section>

<section class="sec" id="ablauf"><div class="wrap scene"><div class="scene-copy"><p class="eyebrow">An der Theke</p><h2>Ein Besuch. Ein Stempel. <em>Bestätigt von deinem Team.</em></h2><p class="lead">Probier es aus: Der Stempel kommt erst, wenn dein Team bestätigt.</p>
</div>
<div class="scene-visual">${phone(visitScreen(demo0, brand0), 'phone-stage')}</div><div class="demo" data-visit>${steps('visit-steps', VISIT_STEPS, visitStep(demo0))}<p class="demo-caption" data-bind="visit-caption">${E.visitCaption}</p><div class="demo-actions"><button type="button" class="btn btn-primary" data-act="visit">Karte öffnen</button><button type="button" class="text-btn" data-new-card>Mit neuer Karte</button></div><p class="owner-line"><span>Im Überblick</span><b data-bind="visit-owner">0&nbsp;bestätigte&nbsp;Besuche · 0&nbsp;Prämien&nbsp;eingelöst</b></p><p class="sr-only" data-live role="status"></p></div></div></section>

<section class="sec sec-white" id="empfehlung"><div class="wrap scene scene-flip"><div class="scene-copy"><p class="eyebrow">Empfehlungen</p><h2>Deine Stammkunden bringen den <em>nächsten Kunden</em> mit.</h2><p class="lead">Lena teilt ihren Link. Den Bonus gibt es erst, wenn dein Team den ersten Besuch von Jonas bestätigt.</p>
</div>
<div class="scene-visual" data-ref-visual>${refVisual(ref0)}</div><div class="demo" data-ref>${steps('ref-steps', REF_STEPS_D, 0)}<p class="demo-caption" data-bind="ref-caption">Lena ist Stammkundin: 7 von 10 Stempeln.</p><div class="demo-actions"><button type="button" class="btn btn-primary" data-act="ref">Link teilen</button><button type="button" class="text-btn" data-reset="ref" hidden>Von vorn</button></div><p class="owner-line"><span>Im Überblick</span><b data-bind="ref-owner">0&nbsp;qualifizierte&nbsp;Empfehlungen</b></p><p class="fine">Teilen, Öffnen oder Anmelden allein bringt keinen Bonus. Auffällige Fälle werden zur Prüfung zurückgestellt.</p><p class="sr-only" data-live role="status"></p></div></div></section>

<section class="sec" id="gestaltung"><div class="wrap"><div class="head"><p class="eyebrow">Gestaltung</p><h2>Deine Marke. <em>Vom Tresen bis zur Kundenkarte.</em></h2><p class="lead">So könnte Loynara in deinem Geschäft aussehen.</p></div>
<div class="studio" id="studio" data-brand-root data-brand="${brand0.style}"><figure class="studio-scene" aria-label="Gestaltungsbeispiel: Aufsteller und Kundenkarte in einer gemeinsamen Markenfarbe"><div class="scene-floor" aria-hidden="true"></div><div class="scene-stand" data-studio-stand>${standObj(brand0)}</div><div id="screen" role="tabpanel" aria-labelledby="screen-karte" data-view="karte" data-studio-phone>${phone(browserScreen(brand0, 8, statusFor(8)), 'phone-studio')}</div></figure>
<div class="studio-side">${seg('screen', 'Ansicht auf dem Handy', [['karte', 'Karte im Browser'], ['wallet', 'Wallet-Vorschau']])}${studioControls(brand0)}<p class="fine">Aufsteller und Wallet-Karte sind Gestaltungsbeispiel und Ausblick. Nichts wird hochgeladen oder gespeichert.</p></div></div></div></section>

<section class="sec dark" id="inhaber"><div class="wrap scene"><div class="scene-copy"><p class="eyebrow">Für dich als Inhaber</p><h2>Du siehst, wer wiederkommt. <em>Und wann du etwas tun kannst.</em></h2>${seg('owner', 'Inhaber-Ansichten', [['back', 'Wer kommt wieder?'], ['gone', 'Wer fehlt?'], ['quiet', 'Wann ist es ruhig?']], 'seg seg-stack')}<p class="fine">Der Überblick gehört zum Pilotangebot. Wer fehlt und ruhige Zeiten sind Plattform-Ausblick; Nachrichten bleiben Vorschau.</p></div>
<div class="scene-visual"><div class="owner-card" id="owner" role="tabpanel" aria-labelledby="owner-back" data-view="back">${(['back', 'gone', 'quiet'] as const).map((v, i) => `<div class="ov" data-show="${v}"${i ? ' hidden' : ''}>${ownerViewsD[v]}</div>`).join('')}</div></div></div></section>

<section class="sec" id="rechner"><div class="wrap"><div class="head"><p class="eyebrow">Rechenbeispiel · Für einen Standort</p><h2>Was wäre ein zusätzlicher Besuch <em>wert?</em></h2><p class="lead">Deine Zahlen, deine Annahme.</p></div>
<div class="calc" data-calc><form class="inputs" id="calc-form" novalidate autocomplete="off">${calcField('visits', EXAMPLE.visits, 'Einkäufe, nicht verschiedene Personen.')}${calcField('basket', EXAMPLE.basket)}${calcField('days', EXAMPLE.days)}${calcField('gain', EXAMPLE.gain, 'Deine Annahme – kein Erfahrungswert von Loynara.')}<button type="button" class="text-btn" data-calc-reset>Beispielwerte</button><noscript><p class="fine">Ohne JavaScript zeigt die Seite das Beispiel mit den voreingestellten Werten.</p></noscript></form>
<div class="result" data-result><p class="res-label">Zusätzlicher Monatsumsatz im Beispiel</p><p class="res-big" data-out="additional">${euro(s0.additional)}</p><dl class="rows"><div><dt>Loynara</dt><dd><span data-out="fee">${euro(s0.fee)}</span> / Monat</dd></div><div><dt>Nach Gebühr</dt><dd data-out="difference">${signedEuro(s0.difference)}</dd></div><div><dt>Auf zwölf Monate</dt><dd data-out="annualised">${signedEuro(s0.annualised)}</dd></div></dl><p class="res-warn" data-zero-note hidden>Bei dieser Annahme übersteigt die Monatsgebühr den Zusatzumsatz.</p><p class="res-note"><b>Rechenbeispiel, keine Umsatzprognose.</b> Wareneinsatz, Prämien, zusätzliche Arbeitskosten und Steuern sind nicht berücksichtigt.</p><p class="calc-empty" data-calc-empty>Trage in allen vier Feldern gültige Zahlen ein, um das Beispiel zu sehen.</p></div>
<figure class="chartfig"><figcaption class="legend"><span><i class="sw-line base"></i>Ohne angenommene Steigerung</span><span><i class="sw-line scen"></i>Mit deiner angenommenen Steigerung</span></figcaption><svg data-chart viewBox="0 0 ${COMPACT.width} ${COMPACT.height}" role="img" aria-label="Kumulierter Umsatz über zwölf Monate, mit und ohne angenommene Steigerung. Der Abstand ist der Zusatzumsatz vor Gebühr. Die Werte stehen auch in der Tabelle darunter.">${plot({ points: pts0, top: sc0.top, tickStep: sc0.step, active: null, geometry: COMPACT })}</svg><details class="ctable"><summary>Werte als Tabelle</summary><div data-table tabindex="0" role="region" aria-label="Werte je Monat als Tabelle">${tableHtml(pts0)}</div></details></figure>
<details class="more"><summary>Berechnung und Annahmen im Detail</summary><div class="more-body"><p class="rl"><span>Bisheriger Monatsumsatz</span><b data-out="baseline">${euro(s0.baseline)}</b></p><p class="rl"><span>Zusatzumsatz im Vergleich zur Monatsgebühr</span><b data-out="ratio">${ratioText(s0.ratio)}</b></p><p class="fine">Ein Vergleich von Umsatz und Gebühr – kein Gewinn und keine garantierte Rendite. Die Grafik zeigt den Zusatzumsatz vor Gebühr; die Differenz nach Gebühr steht oben.</p><ul><li>Der durchschnittliche Einkaufswert bleibt gleich; die Öffnungstage sind in jedem Monat gleich.</li><li>Die angenommene Zunahme gilt konstant jeden Monat – ohne Wachstum, Saison oder Rückgang.</li><li>Die Differenz ist Umsatz minus Monatsgebühr, kein Gewinn: Wareneinsatz, Prämien, Arbeitszeit und Steuern fehlen.</li><li>Ein Einkauf, der ohnehin stattgefunden hätte, ist kein Zusatzumsatz.</li></ul></div></details>
<div class="calc-cta"><button type="button" class="btn btn-ghost" data-calc-share>Diese Zahlen in meiner Anfrage übernehmen</button><a class="btn btn-primary" href="#anfrage">Demo anfragen</a></div><p class="sr-only" data-calc-live role="status"></p></div></div></section>

<section class="sec sec-white" id="angebot"><div class="wrap offer-grid"><div class="offer-copy"><p class="eyebrow">Pilotangebot</p><h2>Ein Preis pro Standort. <em>Ohne App für deine Kunden.</em></h2><p class="lead">Nach deiner Anfrage zeigen wir dir den Ablauf und besprechen den Start.</p></div>
<div class="price-card"><p class="price"><b>${price}</b><span>pro Monat und Standort</span></p><p class="price-note">${SITE.price.note}</p><ul class="checks">${INCLUDED.map(x => `<li>${x}</li>`).join('')}</ul><a class="btn btn-primary btn-block" href="#anfrage">Demo anfragen</a><p class="fine">Vorläufiger Einstiegspreis. Konditionen besprechen wir vor dem Start persönlich. ${E.priceOutlook} zeigen wir als Ausblick und vereinbaren sie gesondert.</p></div>
<div class="faq"><h3>Gut zu wissen</h3>${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div></div></section>

<section class="sec" id="anfrage"><div class="wrap contact-grid"><div class="contact-copy"><p class="eyebrow">Demo anfragen</p><h2>Gib dem nächsten Besuch einen Grund. <em>Und der nächsten Empfehlung einen Weg.</em></h2><p class="lead">Wir zeigen dir Loynara am Beispiel deines Geschäfts.</p>
<ol class="next"><li><b>Anfrage senden</b><span>Du schickst die vorbereitete E-Mail ab.</span></li><li><b>Wir melden uns</b><span>Und stimmen einen Termin mit dir ab.</span></li><li><b>Demo am Beispiel deines Geschäfts</b><span>Wir zeigen dir den Ablauf.</span></li></ol><p class="fine">Schon dabei? <a href="${SITE.loginUrl}">Zur Anmeldung</a></p></div>
<div class="request"><h3>Anfrage vorbereiten</h3><p class="fine">Die Anfrage wird in deinem E-Mail-Programm geöffnet. Gesendet wird sie erst dort.</p>
<form id="request-form" novalidate><label for="req-business">Geschäft</label><input id="req-business" required maxlength="120" autocomplete="organization" aria-describedby="request-status"><label for="req-industry">Branche <span>optional</span></label><select id="req-industry"><option value="">Bitte wählen</option>${industryKeys.map(k => `<option>${industries[k].label}</option>`).join('')}<option>Anderes</option></select><label for="req-message">Kurze Nachricht <span>optional</span></label><textarea id="req-message" rows="3" maxlength="1200"></textarea><p class="figures" id="request-figures" hidden><span id="request-figures-text"></span> <button type="button" class="text-btn" id="request-figures-remove">Entfernen</button></p><button class="btn btn-primary btn-block" type="submit">E-Mail vorbereiten ${arrow}</button><button class="btn btn-ghost btn-block" id="request-copy" type="button" hidden>Text kopieren</button><p id="request-status" class="request-status" role="status"></p></form>
<p class="fine">Oder direkt: <a href="${mailto('Demo-Anfrage Loynara')}">E-Mail an ${SITE.supportEmail}</a></p></div></div></section>
</main>${footer}</body></html>`;
}

/** Supporting page: same chrome as the home page, static (no script needed). */
export function subPage(p: SubPage): string {
  return `${head({ title: p.title, description: p.description, path: p.path, robots: 'index,follow' })}</head><body>${header(false)}${subPageBody(p)}${footer}</body></html>`;
}

export type LegalFragments = { impressum: string | null; datenschutz: string | null };
/** Legal pages carry only operator-approved text. Without it they hold a neutral placeholder and are kept out of search results. */
export function legalPage(kind: 'impressum' | 'datenschutz', fragments: LegalFragments): string {
  const title = kind === 'impressum' ? 'Impressum' : 'Datenschutzerklärung';
  const approved = fragments[kind];
  const body = approved ?? `<p data-legal-placeholder>Hier erscheint der vom Betreiber freigegebene Text (${escapeText(title)}). Er wird vor der Veröffentlichung ergänzt.</p>`;
  return `${head({ title: `${title} | Loynara`, description: `${title} von Loynara.`, path: `/${kind}/`, robots: approved ? 'index,follow' : 'noindex,nofollow' })}</head><body>${header(false)}<main id="inhalt" class="legal"><div class="wrap narrow"><h1>${title}</h1>${body}<p><a class="underlink" href="/">← Zur Startseite</a></p></div></main>${footer}</body></html>`;
}
