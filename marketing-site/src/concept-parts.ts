/**
 * Design-concept prototypes (/concept-a|b|c/): shared visual primitives.
 * Pure string output, used both at build time and in the browser. Example data only.
 */
import { DEMO, industries } from './site.js';
import { LOGOS } from './brand.js';
import { LIMITS, type FieldKey } from './calc.js';

export const X = industries.cafe;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const REWARD = cap(X.reward);
const monogram = LOGOS.monogramm.svg;

export type CardOpts = { balance: number; status: string; size?: 'lg' | 'md' };
/** One flat loyalty card: name, reward, ten stamps, balance. No nested boxes. */
export function cardHtml({ balance, status, size = 'lg' }: CardOpts): string {
  const stamps = Array.from({ length: DEMO.threshold }, (_, i) => `<li${i < balance ? ' class="on"' : ''}></li>`).join('');
  return `<div class="lcard lcard-${size}" role="img" aria-label="Beispielkarte ${X.name}: ${balance} von ${DEMO.threshold} Stempeln. ${status}"><div class="lc-top"><span class="lc-logo">${monogram}</span><span class="lc-name">${X.name}</span></div><p class="lc-reward">${REWARD} · ab ${DEMO.threshold} Stempeln</p><ol class="lc-stamps" aria-hidden="true">${stamps}</ol><div class="lc-foot" aria-hidden="true"><span class="lc-bal"><b>${balance}</b> / ${DEMO.threshold}</span><span class="lc-status">${status}</span></div></div>`;
}
export const statusFor = (balance: number, redeemed = false) => redeemed ? 'Prämie eingelöst' : balance >= DEMO.threshold ? 'Prämie bereit' : balance === DEMO.threshold - 1 ? 'Noch ein Besuch' : `Noch ${DEMO.threshold - balance} Besuche`;

/** A deterministic QR-like pattern (decorative, encodes nothing). */
function qr(x: number, y: number, size: number, cls: string): string {
  const n = 9, c = size / n; let out = '';
  const finder = (i: number, j: number) => (i < 3 && j < 3) || (i < 3 && j > 5) || (i > 5 && j < 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const on = finder(i, j) || ((i * 7 + j * 3 + i * j) % 5) < 2;
    if (on) out +=`<rect class="${cls}" x="${(x + j * c).toFixed(1)}" y="${(y + i * c).toFixed(1)}" width="${(c - 0.6).toFixed(1)}" height="${(c - 0.6).toFixed(1)}"/>`;
  }
  return out;
}
/** Counter stand (acrylic sign) in the brand colour of the enclosing scope. Gestaltungsbeispiel. */
export function standSvg(label = 'Aufsteller mit NFC und QR-Code – Gestaltungsbeispiel'): string {
  return `<svg class="stand" viewBox="0 0 200 270" role="img" aria-label="${label}"><ellipse class="st-shadow" cx="100" cy="256" rx="88" ry="9"/><rect class="st-base" x="22" y="236" width="156" height="16" rx="8"/><path class="st-edge" d="M44 24h112l14 214H30z"/><path class="st-face" d="M50 30h100l13 206H37z"/><circle class="st-ring" cx="100" cy="74" r="19"/><g transform="translate(86 60) scale(.875)"><path class="st-mono" d="M10 22V10l6 8 6-8v12"/></g><text class="st-name" x="100" y="120" text-anchor="middle">${X.name}</text><text class="st-small" x="100" y="136" text-anchor="middle">Antippen oder scannen</text><rect class="st-qrbg" x="72" y="148" width="56" height="56" rx="6"/>${qr(77, 153, 46, 'st-qr')}<path class="st-wave" d="M92 214a10 10 0 0 1 0 12M97 210a16 16 0 0 1 0 20M102 206a22 22 0 0 1 0 28"/></svg>`;
}
/** Wallet pass preview (a design example, not a working Wallet integration). */
export function walletHtml(balance = 8): string {
  return `<div class="wpass" role="img" aria-label="Wallet-Vorschau: ${X.name}, ${balance} von ${DEMO.threshold} Stempeln, Prämie ${X.reward}"><div class="wp-top"><span class="lc-logo">${monogram}</span><span class="wp-name">${X.name}</span></div><div class="wp-fields"><div><small>Stempel</small><b>${balance} / ${DEMO.threshold}</b></div><div><small>Prämie</small><span>${REWARD}</span></div></div><svg class="wp-code" viewBox="0 0 64 64" aria-hidden="true"><rect class="wp-codebg" width="64" height="64" rx="8"/>${qr(8, 8, 48, 'wp-qr')}</svg></div>`;
}

/** Calculator field. Every concept uses the same data hooks; CSS decides the presentation. */
export function calcField(key: FieldKey, value: number, id: string, hint = ''): string {
  const l = LIMITS[key], r = { visits: [0, 500, 5], basket: [0, 100, 0.5], days: [0, 31, 1], gain: [0, 30, 0.5] }[key];
  const unit = l.unit ? `<span class="cf-unit" aria-hidden="true">${l.unit}</span>` : '';
  return `<div class="cf" data-field="${key}"><div class="cf-head"><label for="${id}-${key}">${l.label}</label><span class="cf-val"><input id="${id}-${key}" data-in="${key}" type="text" inputmode="${l.decimals ? 'decimal' : 'numeric'}" autocomplete="off" spellcheck="false" value="${String(value).replace('.', ',')}" aria-describedby="${id}-${key}-err">${unit}</span></div><input class="range" type="range" data-range="${key}" min="${r[0]}" max="${r[1]}" step="${r[2]}" value="${value}" aria-label="${l.label} – Schieberegler">${hint ? `<p class="cf-hint">${hint}</p>` : ''}<p class="cf-err" id="${id}-${key}-err" data-err="${key}" aria-live="polite"></p></div>`;
}

const HOURS: Array<[string, number, boolean]> = [['10', 62, false], ['11', 88, false], ['12', 78, false], ['13', 62, false], ['14', 30, true], ['15', 26, true], ['16', 30, true], ['17', 48, false]];
export const bars = () => `<div class="bars" role="img" aria-label="Beispiel: Auslastung am Dienstag. Zwischen 14 und 17 Uhr ist deutlich weniger los.">${HOURS.map(([h, v, low]) => `<span class="hbar${low ? ' low' : ''}"><i class="h${v}"></i><small>${h}</small></span>`).join('')}</div>`;
export const pauseLine = () => `<div class="pause" role="img" aria-label="Beispiel: regelmäßige Besuche, danach ${X.regular.pause} ohne bestätigten Besuch"><i></i><i></i><i></i><i></i><i></i><span>${X.regular.pause} Pause</span></div>`;
export const OUTLOOK = 'Plattform-Ausblick – nicht im aktuellen Pilotangebot';
export const message = (text: string) => `<blockquote class="msg"><small>Vorschau · nicht versendet</small><p>${text}</p></blockquote>`;

/** Owner moments: one idea per panel. */
export const ownerPanels = {
  overview: `<p class="cap">Beispieldaten · Teil des Pilotangebots</p><p class="big-num"><b>12</b><span>wiederholte Besuche diese Woche, vom Team bestätigt</span></p><p class="sub">3 Prämien eingelöst · 2 Empfehlungen qualifiziert</p>`,
  quiet: `<p class="cap">${OUTLOOK}</p><h3>Dienstags ab 14 Uhr ist es ruhig.</h3>${bars()}${message(X.quiet.message)}`,
  win: `<p class="cap">${OUTLOOK}</p><h3>${X.regular.who} war ${X.regular.pause} nicht da.</h3>${pauseLine()}${message('Schön, dich bald wiederzusehen. Dein Stand wartet auf dich.')}`,
};
export const REF_FLOW: Array<[string, string]> = [
  ['Kunde A teilt seinen Link', 'Teilen allein bringt noch keinen Bonus.'],
  ['Freund B öffnet ihn', 'Auch das Öffnen zählt noch nicht.'],
  ['Freund B erstellt seine Karte', 'Die Empfehlung ist jetzt offen.'],
  ['Dein Team bestätigt den ersten Besuch', 'Erst dieser Besuch qualifiziert.'],
  ['+1 Bonusstempel für Kunde A', 'Genau einmal verbucht.'],
];
