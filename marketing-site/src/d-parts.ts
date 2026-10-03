/**
 * Concept D: product objects (pure string output, used at build time and in the browser).
 * One phone, one counter stand, one Wallet pass: each surface explains one action. Example data only;
 * decorative patterns encode nothing and are no real QR codes.
 */
import { DEMO } from './site.js';
import { LOGOS, initialBrand, type BrandState } from './brand.js';
import { viewOf, type DemoState } from './demo.js';
import { refView, REF_RULE, type RefState } from './ref.js';
import { X, cardHtml, rewardLine, statusFor, walletHtml } from './final-parts.js';

const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
function pattern(x: number, y: number, size: number, cls: string): string {
  const n = 9, c = size / n; let out = '';
  const finder = (i: number, j: number) => (i < 3 && j < 3) || (i < 3 && j > 5) || (i > 5 && j < 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (finder(i, j) || ((i * 7 + j * 3 + i * j) % 5) < 2) out += `<rect class="${cls}" x="${(x + j * c).toFixed(1)}" y="${(y + i * c).toFixed(1)}" width="${(c - 0.6).toFixed(1)}" height="${(c - 0.6).toFixed(1)}"/>`;
  return out;
}

/** Counter stand as a physical object: acrylic body, light edge, base. Gestaltungsbeispiel – no material, size or inclusion implied. */
export function standObj(b: BrandState = initialBrand()): string {
  return `<svg class="stand-obj" viewBox="0 0 220 300" role="img" aria-label="Aufsteller am Tresen mit NFC-Feld und QR-Code, Gestaltungsbeispiel"><ellipse class="so-shadow" cx="110" cy="284" rx="96" ry="10"/><path class="so-base" d="M22 262h176a8 8 0 0 1 8 8v4a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8v-4a8 8 0 0 1 8-8z"/><path class="so-side" d="M52 22h116l20 242H32z"/><path class="so-face" d="M58 28h104l18 234H40z"/><path class="so-shine" d="M58 28h30L58 262H40z"/><circle class="so-ring" cx="110" cy="80" r="21"/><svg class="so-logo" x="95" y="65" width="30" height="30" viewBox="0 0 32 32">${inner(LOGOS[b.logo].svg)}</svg><text class="so-name" x="110" y="130" text-anchor="middle">${X.name}</text><text class="so-small" x="110" y="146" text-anchor="middle">Antippen oder scannen</text><rect class="so-qrbg" x="80" y="158" width="60" height="60" rx="7"/>${pattern(85, 163, 50, 'so-qr')}<path class="so-wave" d="M100 230a10 10 0 0 1 0 12M105 226a16 16 0 0 1 0 20M110 222a22 22 0 0 1 0 28"/></svg>`;
}

/** A phone as an object. `screen` is its whole content. */
export const phone = (screen: string, cls = '') => `<div class="phone${cls ? ' ' + cls : ''}"><span class="island" aria-hidden="true"></span><div class="screen">${screen}</div></div>`;
export const browserScreen = (b: BrandState, balance: number, status: string, extra = '') => `<p class="url" aria-hidden="true">getloynara.com/karte</p>${cardHtml({ balance, status, brand: b })}${extra}`;
export const walletScreen = (b: BrandState) => `<p class="wallet-head" aria-hidden="true">Wallet</p>${walletHtml(b)}`;

/** The counter demo: one phone whose screen follows the demo state. */
export function visitScreen(s: DemoState, b: BrandState = initialBrand()): string {
  const v = viewOf(s);
  if (!v.hasCard) return `<p class="url" aria-hidden="true">getloynara.com/karte</p><div class="sheet sheet-new"><b>${X.name}</b><span>Neue Karte erstellen – ohne App, ohne Passwort.</span></div>`;
  const sheet = {
    start: '<div class="sheet sheet-tap"><b>Am Aufsteller antippen</b><span>oder den QR-Code scannen</span></div>',
    enroll: '',
    request: '<div class="sheet sheet-wait"><b>Besuch gemeldet</b><span>Dein Team bestätigt gleich.</span></div>',
    request2: '<div class="sheet sheet-wait"><b>Besuch gemeldet</b><span>Dein Team bestätigt gleich.</span></div>',
    confirmed: '<div class="sheet sheet-ok"><b>✓ Stempel erhalten</b><span>Vom Team bestätigt.</span></div>',
    reward: `<div class="sheet sheet-reward"><b>Prämie bereit</b><span>${rewardLine(b)} – an der Kasse einlösen.</span></div>`,
    redeemed: '<div class="sheet sheet-ok"><b>✓ Prämie eingelöst</b><span>Die Karte beginnt von vorn.</span></div>',
  }[s.phase];
  return browserScreen(b, v.balance, statusFor(v.balance, s.phase === 'redeemed'), sheet);
}
export const VISIT_STEPS = ['Karte öffnen', 'Team bestätigt', 'Stempel wächst', 'Prämie einlösen'];
/** Which of the four steps a phase belongs to (and which are done). */
export const visitStep = (s: DemoState) => ({ start: 0, enroll: 0, request: 1, confirmed: 2, request2: 1, reward: 3, redeemed: 4 }[s.phase]);

/** Referral: two people, one evolving picture. */
export function refVisual(r: RefState): string {
  const v = refView(r), b = v.friendBalance;
  return `<div class="ref-pair" data-phase="${r.phase}"><div class="person person-a"><span class="avatar" aria-hidden="true">L</span><b>Lena</b><small>Stammkundin</small><p class="stamps-num"><span>${v.referrerBalance}</span>/${DEMO.threshold}</p>${r.phase === 'qualified' ? `<p class="bonus">+${REF_RULE.referrerBonus} Bonusstempel</p>` : '<p class="bonus bonus-none">kein Bonus</p>'}</div><div class="link" aria-hidden="true"><i></i></div><div class="person person-b"><span class="avatar" aria-hidden="true">J</span><b>Jonas</b><small>${v.friendJoined ? 'neu dabei' : r.phase === 'idle' ? 'noch nicht dabei' : 'hat den Link'}</small><p class="stamps-num"><span>${b ?? '–'}</span>/${DEMO.threshold}</p><p class="bonus bonus-none">${r.phase === 'qualified' ? 'erster Besuch bestätigt' : v.friendJoined ? 'erster Besuch fehlt' : '&nbsp;'}</p></div></div>`;
}
export const REF_STEPS_D = ['Link geteilt', 'Karte erstellt', 'Erster Besuch bestätigt', 'Bonus verbucht'];
/** Lit steps per phase: share 1, open 1, join 2, confirm 4. Opening is not a step of its own because it changes nothing. */
export const refLit = (r: RefState) => ({ idle: 0, shared: 1, opened: 1, joined: 2, qualified: 4 }[r.phase]);

// ---- owner: one picture, three questions --------------------------------------------------------------------------------------------
const people: Array<[string, number, string]> = [['Lena', 9, 'fast voll'], ['Jonas', 4, 'kommt wieder'], ['Aylin', 1, 'neu']];
const dots = (n: number) => `<span class="dots" aria-hidden="true">${Array.from({ length: DEMO.threshold }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span>`;
const HOURS: Array<[string, number, boolean]> = [['10', 62, false], ['11', 88, false], ['12', 78, false], ['13', 62, false], ['14', 30, true], ['15', 26, true], ['16', 30, true], ['17', 48, false]];
const preview = (text: string) => `<blockquote class="preview"><small>Vorschau · nicht versendet</small><p>${text}</p></blockquote>`;
export const OUTLOOK_D = 'Plattform-Ausblick';
export const ownerViewsD = {
  back: `<p class="ov-meta">Diese Woche · Beispieldaten</p><p class="ov-big"><b>12</b><span>wiederholte Besuche, vom Team bestätigt</span></p><ul class="people">${people.map(([n, s, t]) => `<li><span class="avatar" aria-hidden="true">${n[0]}</span><b>${n}</b>${dots(s)}<small>${t}</small></li>`).join('')}</ul>`,
  gone: `<p class="ov-meta">${OUTLOOK_D} · Beispiel</p><p class="ov-title">${X.regular.who} war ${X.regular.pause} nicht da.</p><div class="pause" role="img" aria-label="Beispiel: regelmäßige Besuche, danach ${X.regular.pause} ohne bestätigten Besuch"><i></i><i></i><i></i><i></i><i></i><span>${X.regular.pause} Pause</span></div><p class="ov-note">Sonst alle 10 bis 14 Tage. Den Grund kennt nur sie.</p>${preview('Schön, dich bald wiederzusehen. Dein Stand wartet auf dich.')}`,
  quiet: `<p class="ov-meta">${OUTLOOK_D} · Beispiel</p><p class="ov-title">Dienstags ab 14 Uhr ist es ruhig.</p><div class="bars" role="img" aria-label="Beispiel: Auslastung am Dienstag. Zwischen 14 und 17 Uhr ist deutlich weniger los.">${HOURS.map(([h, v, low]) => `<span class="hbar${low ? ' low' : ''}"><i class="h${v}"></i><small>${h}</small></span>`).join('')}</div>${preview(X.quiet.message)}`,
};
