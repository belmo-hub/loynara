/** Page shells: metadata, the home page (body in src/home.ts) and the supporting and legal pages with their shared header and footer. Static HTML, German only. */
import { ENTRY_COPY as E } from './src/claims.js';
import { SITE } from './src/site.js';
import { homeBody } from './src/home.js';
import { subPageBody, type SubPage } from './src/pages.js';

const TITLE = 'Loynara: Die Stempelkarte für deinen Tresen';
const DESCRIPTION = `Digitale Stempel- und Punktekarte für kleine Geschäfte. Dein Team bestätigt jeden Stempel. ${SITE.price.amount} € pro Monat und Standort, erster Monat gratis.`;
const SOCIAL_TITLE = 'Loynara – Aus Kunden werden Stammkunden';
const SOCIAL_DESCRIPTION = `Digitale Kundenkarte für lokale Geschäfte. ${E.social} – dein Team bestätigt jeden Besuch.`;
const mark = '<img src="/assets/loynara-mark.svg" width="32" height="32" alt=""><span class="wordmark">Loynara</span>';
export const escapeText = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const head = (opts: { title: string; description: string; path: string; robots: string; social?: boolean; styles?: string }) => `<!doctype html><html lang="de" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#EEF0EF"><title>${opts.title}</title><meta name="description" content="${opts.description}"><meta name="robots" content="${opts.robots}"><link rel="canonical" href="${SITE.origin}${opts.path}"><link rel="icon" href="/assets/loynara-mark.svg" type="image/svg+xml"><meta property="og:type" content="website"><meta property="og:locale" content="de_DE"><meta property="og:site_name" content="Loynara"><meta property="og:title" content="${opts.social ? SOCIAL_TITLE : opts.title}"><meta property="og:description" content="${opts.social ? SOCIAL_DESCRIPTION : opts.description}"><meta property="og:url" content="${SITE.origin}${opts.path}"><meta property="og:image" content="${SITE.origin}/assets/social-preview.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${opts.social ? SOCIAL_TITLE : opts.title}"><meta name="twitter:description" content="${opts.social ? SOCIAL_DESCRIPTION : opts.description}"><meta name="twitter:image" content="${SITE.origin}/assets/social-preview.png"><link rel="preload" href="/assets/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="${opts.styles ?? '/styles.css'}">`;

export const header = (home: boolean) => {
  const base = home ? '' : '/';
  return `<a class="skip" href="#inhalt">Zum Inhalt springen</a><header class="top"><div class="wrap bar"><a class="logo" href="/" aria-label="Loynara Startseite">${mark}</a><nav class="mainnav" aria-label="Hauptnavigation"><a href="${base}#ablauf">So funktioniert’s</a><a href="${base}#geschaefte">Für dein Geschäft</a><a href="${base}#preis">Preis</a><a href="${base}#fragen">Fragen</a></nav><div class="bar-actions"><a class="login" href="${SITE.loginUrl}">Anmelden</a><a class="btn btn-small" href="${base}#anfrage">Demo anfragen</a></div></div></header>`;
};
export const footer = `<footer class="foot"><div class="wrap"><div class="foot-top"><a class="logo" href="/" aria-label="Loynara Startseite">${mark}</a><p>Wiederkommen belohnen. Weiterempfehlen leicht machen.</p></div><nav class="foot-links" aria-label="Branchen und Themen"><a href="/fuer-barber/">Für Barber</a><a href="/fuer-pizzerien/">Für Pizzerien</a><a href="/empfehlungen/">Kunden werben Kunden</a></nav><nav class="foot-links" aria-label="Rechtliches und Kontakt"><a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a><a href="${SITE.loginUrl}">Anmelden</a><a href="mailto:${SITE.supportEmail}">${SITE.supportEmail}</a></nav><p class="foot-note">© Loynara</p></div></footer>`;

export function homePage(): string {
  return `${head({ title: TITLE, description: DESCRIPTION, path: '/', robots: 'index,follow', social: true, styles: '/home.css' })}<script type="module" src="/assets/home.js"></script><noscript><link rel="stylesheet" href="/home-static.css"></noscript></head>
<body>
${homeBody()}
</body></html>`;
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
