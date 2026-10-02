import { SITE, industries, industryKeys } from './src/site.js';
import { initialDemo } from './src/demo.js';
import { demoScreens, escapeText, STEP_TITLES, stepDescription } from './src/views.js';

const TITLE = 'Loynara – Digitale Kundenkarte mit NFC & QR für lokale Geschäfte';
const DESCRIPTION = 'Loynara ist die moderne digitale Kundenkarte für lokale Geschäfte: Kunden tippen ein NFC-Schild oder scannen einen QR-Code, dein Team bestätigt den Besuch – ohne App für deine Kunden.';
const SOCIAL_TITLE = 'Loynara – Aus Kunden werden Stammkunden';
const SOCIAL_DESCRIPTION = 'Digitale Kundenkarte für lokale Geschäfte. Per NFC-Tap oder QR-Code, ohne App – dein Team bestätigt jeden Besuch.';
const mark = '<img src="/assets/loynara-mark.svg" width="36" height="36" alt=""><span>Loynara</span>';
const arrow = '<span aria-hidden="true">→</span>';
const mailto = (subject: string) => `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(subject)}`;

const head = (opts: { title: string; description: string; path: string; robots: string; social?: boolean }) => `<!doctype html><html lang="de" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#163e35"><title>${opts.title}</title><meta name="description" content="${opts.description}"><meta name="robots" content="${opts.robots}"><link rel="canonical" href="${SITE.origin}${opts.path}"><link rel="icon" href="/assets/loynara-mark.svg" type="image/svg+xml"><meta property="og:type" content="website"><meta property="og:locale" content="de_DE"><meta property="og:site_name" content="Loynara"><meta property="og:title" content="${opts.social ? SOCIAL_TITLE : opts.title}"><meta property="og:description" content="${opts.social ? SOCIAL_DESCRIPTION : opts.description}"><meta property="og:url" content="${SITE.origin}${opts.path}"><meta property="og:image" content="${SITE.origin}/assets/social-preview.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${opts.social ? SOCIAL_TITLE : opts.title}"><meta name="twitter:description" content="${opts.social ? SOCIAL_DESCRIPTION : opts.description}"><meta name="twitter:image" content="${SITE.origin}/assets/social-preview.png"><link rel="preload" href="/assets/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css">`;

const header = (home: boolean) => {
  const base = home ? '' : '/';
  return `<a class="skip" href="#inhalt">Zum Inhalt springen</a><header class="header"><div class="wrap nav"><a class="brand" href="/" aria-label="Loynara Startseite">${mark}</a><button class="menu-toggle" id="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav">Menü <span aria-hidden="true">☰</span></button><nav id="main-nav" aria-label="Hauptnavigation"><a href="${base}#ablauf">So funktioniert’s</a><a href="${base}#nfc">NFC</a><a href="${base}#funktionen">Funktionen</a><a href="${base}#demo">Demo</a><a href="${base}#preis">Preis</a><a href="${base}#faq">Fragen</a><div class="nav-actions"><a class="button quiet" href="${SITE.loginUrl}">Anmelden</a><a class="button primary" href="${base}#anfrage">Demo anfragen</a></div></nav></div></header>`;
};

const footer = `<footer class="footer"><div class="wrap"><div class="footer-top"><a class="brand" href="/" aria-label="Loynara Startseite">${mark}</a><p>Digitale Kundenkarte für lokale Geschäfte.<br>Einfach für Kunden. Klar für dein Team.</p></div><nav class="footer-links" aria-label="Rechtliches und Kontakt"><a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a><a href="${SITE.termsUrl}">Teilnahmebedingungen</a><a href="${SITE.loginUrl}">Anmelden</a><a href="mailto:${SITE.supportEmail}">${SITE.supportEmail}</a></nav><p class="footer-note">© Loynara</p></div></footer>`;

const faq: Array<[string, string]> = [
  ['Brauchen meine Kunden eine App?', 'Nein. Die Karte öffnet sich im Browser – per Tap auf das NFC-Schild oder per Scan des QR-Codes. Es gibt nichts zu installieren.'],
  ['Was passiert, wenn ein Kunde zum ersten Mal kommt?', 'Nach dem Tap oder Scan erstellt der Kunde in wenigen Sekunden seine Karte. Danach läuft sein Besuch direkt weiter zur Bestätigung durch dein Team.'],
  ['Wie kommt ein Kunde beim nächsten Besuch zu seiner Karte?', 'Beim nächsten Tap erkennt Loynara die gespeicherte Karte im Browser. Sonst öffnet er sie über seinen privaten Kartenlink oder den QR-Code der Karte.'],
  ['Wer vergibt die Stempel?', 'Dein Team. Ein Tap oder Scan löst nur eine Anfrage aus. Ein Stempel wird erst vergeben, wenn jemand aus deinem Team den Besuch bestätigt – genau einmal pro Anfrage.'],
  ['Was, wenn ein Handy kein NFC hat?', 'Dann nutzt der Kunde den QR-Code am Tresen. QR bleibt immer als Alternative bestehen.'],
  ['Ist Loynara ein Bezahlsystem?', 'Nein. Bezahlt wird wie bisher. Loynara ist deine Kundenkarte und bietet weder Zahlungsfunktion noch Kassenanbindung.'],
  ['Welches Gerät braucht mein Team?', 'Ein Smartphone, Tablet oder Computer mit Internetverbindung. Mitarbeitende melden sich mit ihrem eigenen Zugang an und sehen nur, was ihre Rolle erlaubt.'],
  ['Was kostet Loynara?', `Aktuell ${SITE.price.amount} € pro Monat und Standort. ${SITE.price.note}.`],
  ['Wer sieht die Daten meiner Kunden?', 'Jedes Geschäft sieht nur die eigenen Kunden und Karten. Mehr dazu in der Datenschutzerklärung.'],
  ['Wie starten wir?', 'Du fragst eine Demo an, wir zeigen dir den Ablauf und richten gemeinsam Programm, Karte, Teamzugänge sowie NFC-Schild und QR-Code für deinen Tresen ein.'],
];

const features: Array<[string, string]> = [
  ['Digitale Kundenkarte', 'Läuft im Browser, ohne App. Mit dem Namen und den Farben deines Geschäfts.'],
  ['Stempel oder Punkte', 'Wähle deine Regel und lege eine oder mehrere Prämien fest.'],
  ['NFC und QR', 'Ein Tap am NFC-Schild oder ein Scan des QR-Codes – beide Wege führen zur gleichen Karte.'],
  ['Bestätigung an der Kasse', 'Dein Team bestätigt jeden Besuch. Nichts wird automatisch vergeben.'],
  ['Kunden im Blick', 'Alle Kundenkarten, Stände und Aktivitäten in deiner Übersicht.'],
  ['Auswertung', 'Bestätigte Besuche und Einlösungen auf einen Blick, nachvollziehbar je Zeitraum.'],
  ['Team und Rollen', 'Inhaber, Leitung und Kasse mit jeweils passenden Rechten und eigenem Zugang.'],
  ['Mehrere Standorte', 'Ein Geschäft, mehrere Standorte – Karten, Team und Auswertung bleiben getrennt nachvollziehbar.'],
  ['Empfehlungen', 'Kunden laden Freunde ein; ein bestätigter Erstbesuch kann einen Bonus auslösen.'],
];

export function homePage(): string {
  const x = industries.cafe;
  const demoState = initialDemo(x.threshold);
  return `${head({ title: TITLE, description: DESCRIPTION, path: '/', robots: 'index,follow', social: true })}<script type="module" src="/assets/modules/browser.js"></script></head>
<body data-industry="cafe">${header(true)}
<main id="inhalt">
<section class="hero"><div class="wrap hero-grid"><div class="hero-copy"><p class="eyebrow">Digitale Kundenkarte für lokale Geschäfte</p><h1>Mach aus Kunden <em>Stammkunden.</em></h1><p class="lead">Loynara ist die moderne digitale Kundenkarte für Cafés, Salons, Studios und andere lokale Geschäfte: Kunden tippen ein NFC-Schild oder scannen einen QR-Code, dein Team bestätigt den Besuch – ganz ohne App.</p><div class="actions"><a class="button primary" href="#demo">Demo ansehen ${arrow}</a><a class="button secondary" href="${SITE.loginUrl}">Anmelden</a></div><p class="hero-sub"><a href="#anfrage" class="underlink">Oder gleich Demo anfragen →</a></p></div>
<div class="hero-visual" aria-label="Illustration: Handy am NFC-Schild mit Treuekarte"><div class="phone"><div class="demo-card"><div class="card-top"><img src="/assets/loynara-mark.svg" width="26" height="26" alt=""><span>${x.name}</span></div><p>${x.reward} · nach ${x.threshold} Stempeln</p><div class="stamp-grid">${Array.from({ length: x.threshold }, (_, i) => `<span class="stamp${i < 5 ? ' filled' : ''}" aria-hidden="true">${i < 5 ? '✓' : String(i + 1).padStart(2, '0')}</span>`).join('')}</div><div class="card-total"><strong>5<small> / ${x.threshold}</small></strong><span>Noch 3 bis zur Prämie</span></div></div></div><div class="stand"><span class="waves" aria-hidden="true">)))</span><strong>Tap für deine Karte</strong><small>Oder QR-Code scannen</small></div></div></div></section>

<section class="section" id="ablauf"><div class="wrap"><div class="section-heading"><p class="eyebrow">So funktioniert’s</p><h2>Kunde, Kasse, Inhaber – ein durchgehender Ablauf</h2><p>Drei Rollen, eine Karte. Jeder Besuch läuft von der Kundenkarte über die Bestätigung deines Teams bis in deine Übersicht.</p></div>
<ol class="flow"><li><span class="tag">Kunde</span><h3>Karte öffnen</h3><p>Tippt das NFC-Schild oder scannt den QR-Code. Die Karte öffnet sich im Browser, neue Kunden erstellen sie in Sekunden.</p></li><li class="flow-arrow" aria-hidden="true">→</li><li><span class="tag">Kasse</span><h3>Besuch bestätigen</h3><p>Dein Team sieht die Anfrage oder scannt die Karte und bestätigt den Besuch. Erst dann wird der Stempel vergeben.</p></li><li class="flow-arrow" aria-hidden="true">→</li><li><span class="tag">Inhaber</span><h3>Überblick behalten</h3><p>Du siehst Kunden, bestätigte Besuche, Einlösungen und die Auswertung deines Programms.</p></li></ol></div></section>

<section class="section nfc" id="nfc"><div class="wrap nfc-grid"><div><p class="eyebrow">NFC am Tresen</p><h2>Ein Tap. <em>Die Karte ist da.</em></h2><p class="lead">Kunden halten ihr Handy an das NFC-Schild an deinem Tresen. Die Loynara-Karte öffnet sich im Browser – ohne App, ohne Anmeldung vorab.</p>
<ol class="nfc-steps"><li><strong>Tap am Schild.</strong> Das Handy öffnet deine Kundenkarte im Browser.</li><li><strong>Neu oder wiederkehrend.</strong> Neue Kunden erstellen ihre Karte, wiederkehrende finden ihre bestehende Karte wieder.</li><li><strong>Dein Team bestätigt.</strong> Die Anfrage erscheint auf dem Kassenbildschirm; ein Klick bestätigt den Besuch.</li><li><strong>Stand aktualisiert.</strong> Der Stempel erscheint auf der Karte und in deiner Übersicht – genau einmal pro Besuch.</li></ol>
<ul class="chips"><li>Keine App für Kunden</li><li>QR-Code als Alternative</li><li>Team bestätigt jeden Besuch</li></ul><p class="small">Loynara ist kein Bezahlsystem: Bezahlt wird wie bisher, NFC dient nur dazu, die Karte zu öffnen.</p><div class="actions"><a class="button primary" href="#demo">NFC-Ablauf in der Demo ausprobieren ${arrow}</a></div></div>
<div class="nfc-visual" aria-label="Illustration eines NFC-Schilds am Tresen"><div class="counter-stand"><img src="/assets/loynara-mark.svg" width="40" height="40" alt=""><strong>Ein guter Grund, wiederzukommen.</strong><span class="waves" aria-hidden="true">)))</span><p>Handy hier antippen</p><small>Oder QR-Code scannen</small></div></div></div></section>

<section class="section" id="funktionen"><div class="wrap"><div class="section-heading"><p class="eyebrow">Funktionen</p><h2>Alles, was du für den Start brauchst</h2><p>Das, was dein Geschäft heute mit Loynara nutzen kann.</p></div><ul class="feature-grid">${features.map(([h, p]) => `<li><h3>${h}</h3><p>${p}</p></li>`).join('')}</ul></div></section>

<section class="section demo" id="demo"><div class="wrap"><div class="section-heading"><p class="eyebrow">Demo</p><h2>Probiere den Ablauf selbst aus</h2><p>Wähle dein Geschäft und gehe einen Besuch durch. Die Demo läuft nur auf dieser Seite und nutzt Beispieldaten – es wird nichts gespeichert oder gesendet.</p></div>
<div class="industry-options" role="group" aria-label="Geschäftsart wählen">${industryKeys.map(k => `<button type="button" data-industry-choice="${k}" aria-pressed="${k === 'cafe'}" disabled>${industries[k].label}</button>`).join('')}</div>
<div class="industry-panel" id="industry-panel"><h3>${x.name}</h3><p>${x.intro}</p><dl><div><dt>Das zählt als Stempel</dt><dd>${x.visit}</dd></div><div><dt>Prämie</dt><dd>${x.reward} nach ${x.threshold} Stempeln</dd></div><div><dt>Empfehlung</dt><dd>${x.referral}</dd></div></dl></div>
<div class="demo-shell"><div class="demo-top"><span class="demo-badge">Produktdemo · Beispieldaten</span><span id="demo-controls"><button type="button" class="text-button" id="demo-reset" disabled>Neu starten ↺</button></span></div>
<ol class="step-track" id="step-track" aria-label="Ablauf">${STEP_TITLES.map((t, i) => `<li${i === 0 ? ' aria-current="step"' : ''}><span>${i + 1}</span> ${t}</li>`).join('')}</ol>
<div class="step-copy"><p id="step-counter" class="eyebrow">Schritt 1 von 4</p><h3 id="step-title" tabindex="-1">${STEP_TITLES[0]}</h3><p id="step-description">${stepDescription(demoState, 'cafe')}</p></div>
<p id="demo-announcement" class="sr-only" role="status"></p>
<div class="screens" id="demo-screens">${demoScreens(demoState, 'cafe')}</div>
<noscript><p class="notice">Für die interaktive Demo bitte JavaScript aktivieren. Ablauf: Der Kunde tippt das NFC-Schild oder scannt den QR-Code, erstellt oder öffnet seine Karte, dein Team bestätigt den Besuch, und du siehst ihn in deiner Übersicht.</p></noscript>
<div class="demo-nav"><button type="button" class="button secondary" id="demo-back" disabled>Zurück</button><button type="button" class="button primary" id="demo-next" disabled>Weiter ${arrow}</button></div></div></div></section>

<section class="section" id="start"><div class="wrap setup-grid"><div><p class="eyebrow">Gemeinsam starten</p><h2>Dein Programm.<br><em>Ein guter Anfang.</em></h2><p>Wir richten Loynara mit dir ein und zeigen deinem Team den Ablauf.</p></div><ol class="setup-list"><li><span>1</span><div><h3>Demo und Gespräch</h3><p>Du siehst den Ablauf und sagst uns, welche Regel und Prämie zu deinem Geschäft passt.</p></div></li><li><span>2</span><div><h3>Programm und Karte einrichten</h3><p>Geschäftsname, Farben, Stempel- oder Punkteregel, Prämien und Teamzugänge.</p></div></li><li><span>3</span><div><h3>NFC-Schild und QR-Code am Tresen</h3><p>Dein Team übt einen Besuch – danach kennt jeder seinen Schritt.</p></div></li></ol></div></section>

<section class="section pricing" id="preis"><div class="wrap"><div class="section-heading"><p class="eyebrow">Preis</p><h2>Ein klarer Preis pro Standort</h2></div><div class="price-card"><p class="price"><strong>${SITE.price.amount} €</strong><span> / ${SITE.price.unit}</span></p><p class="price-note">${SITE.price.note}</p><ul class="checks"><li>Digitale Kundenkarte mit NFC und QR</li><li>Stempel oder Punkte, Prämien nach deinen Regeln</li><li>Team mit Rollen, Kundenübersicht und Auswertung</li><li>Preis je Standort – weitere Standorte nach Absprache</li></ul><a class="button primary" href="#anfrage">Demo anfragen ${arrow}</a><p class="small">Vorläufiger Einstiegspreis. Die Konditionen klären wir vor dem Start gemeinsam mit dir.</p></div></div></section>

<section class="section faq" id="faq"><div class="wrap faq-layout"><div><p class="eyebrow">Fragen</p><h2>Gut zu wissen</h2></div><div>${faq.map(([q, a]) => `<details><summary>${q}<span aria-hidden="true">+</span></summary><p>${a}</p></details>`).join('')}</div></div></section>

<section class="section closing" id="anfrage"><div class="wrap closing-grid"><div><p class="eyebrow">Demo anfragen</p><h2>Zeig uns dein Geschäft.<br><em>Wir zeigen dir Loynara.</em></h2><p>Schreib uns kurz, wer du bist. Wir melden uns und zeigen dir den Ablauf für dein Geschäft.</p><p class="existing">Schon Kunde? <a class="underlink" href="${SITE.loginUrl}">Zur Anmeldung →</a></p></div>
<div class="request-card"><h3>Anfrage vorbereiten</h3><p class="small">Die Felder bereiten eine E-Mail an <a class="underlink" href="mailto:${SITE.supportEmail}">${SITE.supportEmail}</a> vor. Sie wird erst gesendet, wenn du sie in deinem E-Mail-Programm abschickst.</p>
<form id="request-form" novalidate><label for="req-business">Geschäft</label><input id="req-business" required maxlength="120" autocomplete="organization"><label for="req-industry">Branche</label><select id="req-industry">${industryKeys.map(k => `<option>${industries[k].label}</option>`).join('')}<option>Anderes</option></select><label for="req-locations">Anzahl Standorte <span>optional</span></label><input id="req-locations" inputmode="numeric" maxlength="3"><label for="req-name">Dein Name <span>optional</span></label><input id="req-name" maxlength="120" autocomplete="name"><label for="req-phone">Telefon <span>optional</span></label><input id="req-phone" type="tel" maxlength="40" autocomplete="tel"><label for="req-message">Was möchtest du klären? <span>optional</span></label><textarea id="req-message" rows="3" maxlength="1200"></textarea><button class="button primary full" type="submit">E-Mail vorbereiten ${arrow}</button><button class="button secondary full" id="request-copy" type="button" hidden>Text kopieren</button><p id="request-status" class="request-status" role="status"></p></form>
<p class="small">Oder direkt: <a class="underlink" href="${mailto('Demo-Anfrage Loynara')}">E-Mail an ${SITE.supportEmail}</a></p></div></div></section>
</main>${footer}</body></html>`;
}

export type LegalFragments = { impressum: string | null; datenschutz: string | null };
/** Legal pages carry only operator-approved text. Without it they hold a neutral placeholder and are kept out of search results. */
export function legalPage(kind: 'impressum' | 'datenschutz', fragments: LegalFragments): string {
  const title = kind === 'impressum' ? 'Impressum' : 'Datenschutzerklärung';
  const approved = fragments[kind];
  const body = approved ?? `<p data-legal-placeholder>Hier erscheint der vom Betreiber freigegebene Text (${escapeText(title)}). Er wird vor der Veröffentlichung ergänzt.</p>`;
  return `${head({ title: `${title} | Loynara`, description: `${title} von Loynara.`, path: `/${kind}/`, robots: approved ? 'index,follow' : 'noindex,nofollow' })}<script type="module" src="/assets/modules/browser.js"></script></head><body>${header(false)}<main id="inhalt" class="legal"><div class="wrap narrow"><h1>${title}</h1>${body}<p><a class="underlink" href="/">← Zur Startseite</a></p></div></main>${footer}</body></html>`;
}
