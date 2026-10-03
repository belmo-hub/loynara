/**
 * Final page: shared visual primitives (pure string output, used at build time and in the browser).
 * Brand-aware: logo and reward text follow the BrandState; colours come from the enclosing [data-brand] scope.
 * Example data only. Decorative patterns encode nothing and are no real QR codes.
 */
import { DEMO, industries } from './site.js';
import { LOGOS, REWARD_LABELS, STYLES, initialBrand, rewardText, type BrandState, type LogoKey, type RewardKey, type StyleKey } from './brand.js';
import { LIMITS, type FieldKey } from './calc.js';

export const X = industries.cafe;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const rewardLine = (b: BrandState) => cap(rewardText(b, 'cafe'));
const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

/** One flat loyalty card. The label is the accessible description; the visible text repeats it. */
export function cardHtml(o: { balance: number; status: string; brand?: BrandState; size?: 'lg' | 'md' }): string {
  const b = o.brand ?? initialBrand(), size = o.size ?? 'lg';
  const stamps = Array.from({ length: DEMO.threshold }, (_, i) => `<li${i < o.balance ? ' class="on"' : ''}></li>`).join('');
  return `<div class="lcard lcard-${size}" role="img" aria-label="Beispielkarte ${X.name}: ${o.balance} von ${DEMO.threshold} Stempeln. ${o.status}"><div class="lc-top"><span class="lc-logo">${LOGOS[b.logo].svg}</span><span class="lc-name">${X.name}</span></div><p class="lc-reward">${rewardLine(b)} · ab ${DEMO.threshold} Stempeln</p><ol class="lc-stamps" aria-hidden="true">${stamps}</ol><div class="lc-foot" aria-hidden="true"><span class="lc-bal"><b>${o.balance}</b> / ${DEMO.threshold}</span><span class="lc-status">${o.status}</span></div></div>`;
}
export const statusFor = (balance: number, redeemed = false) => redeemed ? 'Prämie eingelöst' : balance >= DEMO.threshold ? 'Prämie bereit' : balance === DEMO.threshold - 1 ? 'Noch ein Besuch' : `Noch ${DEMO.threshold - balance} Besuche`;

/** Decorative pattern (not a QR code, encodes nothing). */
function pattern(x: number, y: number, size: number, cls: string): string {
  const n = 9, c = size / n; let out = '';
  const finder = (i: number, j: number) => (i < 3 && j < 3) || (i < 3 && j > 5) || (i > 5 && j < 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (finder(i, j) || ((i * 7 + j * 3 + i * j) % 5) < 2) out += `<rect class="${cls}" x="${(x + j * c).toFixed(1)}" y="${(y + i * c).toFixed(1)}" width="${(c - 0.6).toFixed(1)}" height="${(c - 0.6).toFixed(1)}"/>`;
  return out;
}
/** Counter stand: Gestaltungsbeispiel. No dimensions, material or inclusion is implied. */
export function standSvg(b: BrandState = initialBrand()): string {
  return `<svg class="stand" viewBox="0 0 200 270" role="img" aria-label="Aufsteller am Tresen, Gestaltungsbeispiel"><ellipse class="st-shadow" cx="100" cy="256" rx="88" ry="9"/><rect class="st-base" x="22" y="236" width="156" height="16" rx="8"/><path class="st-edge" d="M44 24h112l14 214H30z"/><path class="st-face" d="M50 30h100l13 206H37z"/><circle class="st-ring" cx="100" cy="74" r="19"/><svg class="st-logo" x="86" y="60" width="28" height="28" viewBox="0 0 32 32">${inner(LOGOS[b.logo].svg)}</svg><text class="st-name" x="100" y="120" text-anchor="middle">${X.name}</text><text class="st-small" x="100" y="136" text-anchor="middle">Antippen oder scannen</text><rect class="st-qrbg" x="72" y="148" width="56" height="56" rx="6"/>${pattern(77, 153, 46, 'st-qr')}<path class="st-wave" d="M92 214a10 10 0 0 1 0 12M97 210a16 16 0 0 1 0 20M102 206a22 22 0 0 1 0 28"/></svg>`;
}
/** Wallet-Vorschau: a design example, not a provisioned pass. */
export function walletHtml(b: BrandState = initialBrand(), balance = 8): string {
  return `<div class="wpass" role="img" aria-label="Wallet-Vorschau: ${X.name}, ${balance} von ${DEMO.threshold} Stempeln, Prämie ${rewardText(b, 'cafe')}"><div class="wp-top"><span class="lc-logo">${LOGOS[b.logo].svg}</span><span class="wp-name">${X.name}</span></div><div class="wp-fields"><div><small>Stempel</small><b>${balance} / ${DEMO.threshold}</b></div><div><small>Prämie</small><span>${rewardLine(b)}</span></div></div><svg class="wp-code" viewBox="0 0 64 64" aria-hidden="true"><rect class="wp-codebg" width="64" height="64" rx="8"/>${pattern(8, 8, 48, 'wp-qr')}</svg></div>`;
}

/** The studio picture for the selected view: Tresen (stand + card, default) or Wallet-Vorschau. */
export function studioHtml(b: BrandState, view: 'tresen' | 'wallet'): string {
  if (view === 'wallet') return `<figure class="studio-fig studio-wallet">${walletHtml(b)}<figcaption>Wallet-Vorschau · Ausblick, keine eingerichtete Karte</figcaption></figure>`;
  return `<figure class="studio-fig studio-pair"><div class="pair-stand">${standSvg(b)}</div><div class="pair-card">${cardHtml({ balance: 8, status: statusFor(8), brand: b, size: 'md' })}</div><figcaption>Aufsteller und Karte · Gestaltungsbeispiel</figcaption></figure>`;
}
const SW = (Object.keys(STYLES) as StyleKey[]);
export function studioControls(b: BrandState): string {
  return `<div class="controls"><div class="ctl"><span class="ctl-label" id="ctl-farbe">Farbe <b data-brand-label>${STYLES[b.style].label}</b></span><div class="swatches" role="group" aria-labelledby="ctl-farbe">${SW.map(k => `<button type="button" class="swatch sw-${k}" data-brand-style="${k}" aria-label="${STYLES[k].label}" aria-pressed="${k === b.style}"></button>`).join('')}</div></div><div class="ctl"><span class="ctl-label" id="ctl-marke">Marke</span><div class="logos" role="group" aria-labelledby="ctl-marke">${(Object.keys(LOGOS) as LogoKey[]).map(k => `<button type="button" class="logo-pick" data-brand-logo="${k}" aria-label="Marke: ${LOGOS[k].label}" aria-pressed="${k === b.logo}">${LOGOS[k].svg}</button>`).join('')}</div></div><div class="ctl"><label class="ctl-label" for="brand-reward">Prämie</label><select id="brand-reward" data-brand-reward>${(Object.keys(REWARD_LABELS) as RewardKey[]).map(k => `<option value="${k}"${k === b.reward ? ' selected' : ''}>${REWARD_LABELS[k]}</option>`).join('')}</select></div></div>`;
}

/** Calculator field: label, large value, slider. */
export function calcField(key: FieldKey, value: number, hint = ''): string {
  const l = LIMITS[key], r = { visits: [0, 500, 5], basket: [0, 100, 0.5], days: [0, 31, 1], gain: [0, 30, 0.5] }[key];
  const unit = l.unit ? `<span class="cf-unit" aria-hidden="true">${l.unit}</span>` : '';
  return `<div class="cf" data-field="${key}"><div class="cf-head"><label for="in-${key}">${l.label}</label><span class="cf-val"><input id="in-${key}" data-in="${key}" type="text" inputmode="${l.decimals ? 'decimal' : 'numeric'}" autocomplete="off" spellcheck="false" value="${String(value).replace('.', ',')}" aria-describedby="err-${key}">${unit}</span></div><input class="range" type="range" data-range="${key}" min="${r[0]}" max="${r[1]}" step="${r[2]}" value="${value}" aria-label="${l.label} – Schieberegler">${hint ? `<p class="cf-hint">${hint}</p>` : ''}<p class="cf-err" id="err-${key}" data-err="${key}" aria-live="polite"></p></div>`;
}

// ---- owner moments: one idea per view ----------------------------------------------------------------------------------------------
const HOURS: Array<[string, number, boolean]> = [['10', 62, false], ['11', 88, false], ['12', 78, false], ['13', 62, false], ['14', 30, true], ['15', 26, true], ['16', 30, true], ['17', 48, false]];
export const bars = () => `<div class="bars" role="img" aria-label="Beispiel: Auslastung am Dienstag. Zwischen 14 und 17 Uhr ist deutlich weniger los.">${HOURS.map(([h, v, low]) => `<span class="hbar${low ? ' low' : ''}"><i class="h${v}"></i><small>${h}</small></span>`).join('')}</div>`;
export const pauseLine = () => `<div class="pause" role="img" aria-label="Beispiel: regelmäßige Besuche, danach ${X.regular.pause} ohne bestätigten Besuch"><i></i><i></i><i></i><i></i><i></i><span>${X.regular.pause} Pause</span></div>`;
export const OUTLOOK = 'Plattform-Ausblick – nicht im aktuellen Pilotangebot';
export const message = (text: string) => `<blockquote class="msg"><small>Vorschau · nicht versendet</small><p>${text}</p></blockquote>`;
export const ownerPanels = {
  overview: `<p class="cap">Beispieldaten · Teil des Pilotangebots</p><p class="big-num"><b>12</b><span>wiederholte Besuche diese Woche, vom Team bestätigt</span></p><p class="sub">3 Prämien eingelöst · 2 Empfehlungen qualifiziert</p>`,
  quiet: `<p class="cap">${OUTLOOK}</p><h3>Dienstags ab 14 Uhr ist es ruhig.</h3>${bars()}${message(X.quiet.message)}`,
  win: `<p class="cap">${OUTLOOK}</p><h3>${X.regular.who} war ${X.regular.pause} nicht da.</h3>${pauseLine()}${message('Schön, dich bald wiederzusehen. Dein Stand wartet auf dich.')}`,
};

/** Colour variables per preset (mirror STYLES in brand.ts) and the swatch colours. Appended to the stylesheet by the build. */
export const brandCss = () => (Object.keys(STYLES) as StyleKey[]).map(k => { const s = STYLES[k]; return `[data-brand="${k}"]{--b-dark:${s.dark};--b-mid:${s.mid};--b-accent:${s.accent};--b-soft:${s.soft}}.sw-${k}{--sw:${s.dark}}`; }).join('\n');
