/**
 * Browser wiring for the marketing page (Concept D). Everything lives in page memory: no network, no storage.
 * The tested state machines (demo.ts, ref.ts), brand state (brand.ts) and calculator maths (calc.ts) are reused unchanged.
 * Selecting a tab only changes the view; it never runs a business action.
 */
import { ENTRY_COPY as E } from './claims.js';
import { animate } from 'motion';
import { initialDemo, transition, viewOf, type DemoAction, type DemoState } from './demo.js';
import { initialRef, refTransition, refView, REF_RULE, type RefAction, type RefState } from './ref.js';
import { initialBrand, isLogo, isReward, isStyle, STYLES, type BrandState } from './brand.js';
import { LIMITS, SLIDER_RANGE, compute, euro, formatNumber, niceScale, parseField, ratioText, series, signedEuro, type FieldKey, type Inputs, type Scenario, EXAMPLE } from './calc.js';
import { plot, tableHtml, COMPACT, WIDE } from './chart.js';
import { buildRequest } from './request.js';
import { SITE } from './site.js';
import { stampCount, statusFor } from './final-parts.js';
import { browserScreen, phone, refVisual, refLit, standObj, visitScreen, visitStep, walletScreen } from './d-parts.js';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = [0.22, 1, 0.36, 1] as const;
/** One motion helper (Motion's vanilla `animate`): frames are converted to Motion keyframes; reduced motion skips them entirely. */
const fx = (el: Element | null | undefined, frames: Array<Record<string, string | number>>, ms = 260) => {
  if (!el || calm()) return;
  const kf: Record<string, Array<string | number>> = {}, times: number[] = [];
  frames.forEach((f, i) => { for (const [k, v] of Object.entries(f)) if (k !== 'offset') (kf[k] ??= []).push(v); times.push(typeof f.offset === 'number' ? f.offset : i / (frames.length - 1)); });
  animate(el, kf as never, { duration: ms / 1000, ease: EASE as never, times });
};
const say = (root: Element | null, text: string) => { const live = root?.querySelector('[data-live]'); if (live) live.textContent = text; };
const bind = (root: ParentNode, name: string, text: string) => { for (const el of $$(`[data-bind="${name}"]`, root)) el.textContent = text; };
const plural = (n: number, one: string, many: string) => `${n}\u00a0${n === 1 ? one : many}`;

// ---- tabs: roving tabindex + arrow/Home/End; focus stays on the tab --------------------------------------------------------------
function tabs(list: HTMLElement, onSelect: (view: string) => void) {
  const items = $$<HTMLButtonElement>('[role="tab"]', list);
  const select = (t: HTMLButtonElement, focus = false) => {
    for (const x of items) { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; }
    const panel = document.getElementById(list.dataset.tabs!);
    if (panel) { panel.setAttribute('aria-labelledby', t.id); panel.dataset.view = t.dataset.view; }
    onSelect(t.dataset.view!);
    if (focus) t.focus();
  };
  items.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % items.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + items.length) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
      if (n < 0) return; e.preventDefault(); select(items[n], true);
    });
  });
}
function showView(panelId: string, view: string) {
  const panel = document.getElementById(panelId)!;
  for (const el of $$('[data-show]', panel)) { const on = el.dataset.show === view; if (el.hidden === on) { el.hidden = !on; if (on) fx(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0px)' }]); } }
}
for (const id of ['owner']) { const list = $(`[data-tabs="${id}"]`); if (list) tabs(list, v => showView(id, v)); }

// ---- counter demo (demo.ts): one phone, one action, one owner consequence ----------------------------------------------------------
const visitRoot = $('[data-visit]')!, stagePhone = $('.phone-stage .screen')!;
const VISIT: Record<string, { label: string; action: DemoAction; caption: string }> = {
  start: { label: 'Karte öffnen', action: { type: 'open' }, caption: E.visitCaption },
  enroll: { label: 'Karte erstellen', action: { type: 'enroll' }, caption: 'Eine neue Karte: ohne App und ohne Passwort, direkt im Browser.' },
  request: { label: 'Besuch bestätigen', action: { type: 'confirm' }, caption: 'Die Karte ist offen. Erst wenn dein Team scannt und bestätigt, zählt der Besuch.' },
  confirmed: { label: 'Nächsten Besuch zeigen', action: { type: 'nextVisit' }, caption: 'Ein Stempel, genau einmal – auch bei doppeltem Tippen.' },
  request2: { label: 'Besuch bestätigen', action: { type: 'confirm' }, caption: 'Ein weiterer Besuch. Wieder bestätigt dein Team.' },
  reward: { label: 'Prämie einlösen', action: { type: 'redeem' }, caption: 'Zehn Stempel: Dein Team löst die Prämie an der Kasse ein.' },
  redeemed: { label: 'Von vorn', action: { type: 'reset' }, caption: 'Eingelöst – genau einmal. Die Karte beginnt wieder bei null.' },
};
let visit: DemoState = initialDemo('returning');
const visitAct = $<HTMLButtonElement>('[data-act="visit"]', visitRoot)!, newCard = $<HTMLButtonElement>('[data-new-card]', visitRoot)!;
function renderVisit(prev?: DemoState) {
  const v = viewOf(visit), step = visitStep(visit), isNewDone = visit.identity === 'new' && visit.phase === 'confirmed';
  stagePhone.innerHTML = visitScreen(visit);
  $$('.visit-steps li', visitRoot).forEach((li, i) => { li.classList.toggle('done', i < step); li.classList.toggle('now', i === step); });
  bind(visitRoot, 'visit-caption', isNewDone ? 'Erster Stempel auf der neuen Karte. Bis zur Prämie braucht sie zehn bestätigte Besuche.' : VISIT[visit.phase].caption);
  bind(visitRoot, 'visit-owner', `${plural(v.confirmedVisits, 'bestätigter\u00a0Besuch', 'bestätigte\u00a0Besuche')} · ${plural(v.redemptions, 'Prämie\u00a0eingelöst', 'Prämien\u00a0eingelöst')}`);
  visitAct.textContent = isNewDone ? 'Von vorn' : VISIT[visit.phase].label;
  newCard.textContent = visit.identity === 'new' ? 'Mit Stammkundin (8 von 10)' : 'Mit neuer Karte';
  // The new stamp lands like the hero's: CSS keyframes (coral flash + ink ring); reduced motion switches them off.
  if (prev && viewOf(prev).balance < v.balance) stagePhone.querySelectorAll('.lc-stamps li')[v.balance - 1]?.classList.add('land');
  if (prev && prev.phase !== visit.phase) fx(stagePhone.querySelector('.sheet'), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0px)' }], 260);
}
visitAct.addEventListener('click', () => {
  const prev = visit;
  visit = visit.identity === 'new' && visit.phase === 'confirmed' ? initialDemo('new') : transition(visit, VISIT[visit.phase].action);
  if (visit !== prev) { renderVisit(prev); say(visitRoot, $('[data-bind="visit-caption"]', visitRoot)!.textContent ?? ''); }
});
newCard.addEventListener('click', () => { visit = initialDemo(visit.identity === 'new' ? 'returning' : 'new'); renderVisit(); visitAct.focus(); say(visitRoot, visit.identity === 'new' ? 'Neue Karte: Sie beginnt bei null.' : 'Stammkundin: 8 von 10 Stempeln.'); });

// ---- referral (ref.ts): two people, one evolving picture -----------------------------------------------------------------------------
const refRoot = $('[data-ref]')!, refPic = $('[data-ref-visual]')!;
const REF: Record<string, { label: string; action: RefAction; caption: string }> = {
  idle: { label: 'Link teilen', action: 'share', caption: 'Lena ist Stammkundin: 7 von 10 Stempeln.' },
  shared: { label: 'Jonas öffnet den Link', action: 'open', caption: 'Link geteilt. Das allein bringt noch keinen Bonus.' },
  opened: { label: 'Jonas erstellt seine Karte', action: 'join', caption: 'Jonas hat den Link geöffnet – auch das zählt noch nicht.' },
  joined: { label: 'Ersten Besuch bestätigen', action: 'confirm', caption: 'Jonas hat eine Karte. Jetzt fehlt sein erster bestätigter Besuch.' },
  qualified: { label: '✓ Bonus verbucht', action: 'reset', caption: `Bedingung erfüllt: +${REF_RULE.referrerBonus} Bonusstempel für Lena, genau einmal verbucht.` },
};
let ref: RefState = initialRef();
const refAct = $<HTMLButtonElement>('[data-act="ref"]', refRoot)!, refReset = $<HTMLButtonElement>('[data-reset="ref"]', refRoot)!;
function renderRef(prev?: RefState) {
  const v = refView(ref), lit = refLit(ref), done = ref.phase === 'qualified';
  refPic.innerHTML = refVisual(ref);
  $$('.ref-steps li', refRoot).forEach((li, i) => { li.classList.toggle('done', i < lit); li.classList.toggle('now', i === lit); });
  bind(refRoot, 'ref-caption', REF[ref.phase].caption);
  bind(refRoot, 'ref-owner', `${plural(v.qualifiedReferrals, 'qualifizierte\u00a0Empfehlung', 'qualifizierte\u00a0Empfehlungen')}${done ? ` · ${v.bonusBooked}\u00a0Bonus\u00a0verbucht` : ''}`);
  refAct.textContent = REF[ref.phase].label; refAct.disabled = done; refReset.hidden = !done;
  if (prev && prev.phase !== ref.phase) fx(refPic.querySelector(done ? '.person-a' : '.person-b'), [{ transform: 'translateY(6px) scale(0.97)' }, { transform: 'translateY(0px) scale(1)' }], 300);
}
refAct.addEventListener('click', () => { const prev = ref; ref = refTransition(ref, REF[ref.phase].action); if (ref !== prev) { renderRef(prev); say(refRoot, REF[ref.phase].caption); } });
refReset.addEventListener('click', () => { ref = refTransition(ref, 'reset'); renderRef(); refAct.focus(); say(refRoot, 'Beispiel zurückgesetzt.'); });

// ---- brand studio: one brand for stand, card and Wallet-Vorschau (page memory only) -------------------------------------------------------
const studio = $('#studio')!;
let brand: BrandState = initialBrand(), screen: 'karte' | 'wallet' = 'karte';
/**
 * Colour flood: a text-free copy of the old scene lies over the new one and is masked away by a circle growing from the
 * pressed control (clamped to the scene edge), so the new brand spreads like ink. The copy lives outside #studio, has no ids,
 * is aria-hidden and inert, and removes itself.
 */
function flood(from: Element): boolean {
  const scene = $('.studio-scene', studio);
  if (!scene || calm()) return false;
  const r = scene.getBoundingClientRect(), f = from.getBoundingClientRect();
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const old = document.createElement('div'), copy = scene.cloneNode(true) as HTMLElement;
  for (const e of [copy, ...copy.querySelectorAll('[id],[aria-label],[role]')]) { e.removeAttribute('id'); e.removeAttribute('aria-label'); e.removeAttribute('role'); }
  old.className = 'flood'; old.dataset.brand = brand.style; old.setAttribute('aria-hidden', 'true'); old.inert = true; old.append(copy);
  for (const [k, v] of [['left', r.left + scrollX], ['top', r.top + scrollY], ['width', r.width], ['height', r.height]] as const) old.style.setProperty(k, `${v}px`);
  old.style.setProperty('--fx', `${clamp(f.left + f.width / 2, r.left, r.right) - r.left}px`);
  old.style.setProperty('--fy', `${clamp(f.top + f.height / 2, r.top, r.bottom) - r.top}px`);
  for (const prev of $$('.flood')) prev.remove();
  document.body.append(old);
  const done = () => old.remove();
  old.addEventListener('animationend', done, { once: true }); setTimeout(done, 1600);
  return true;
}
function renderStudio(changed = false) {
  studio.dataset.brand = brand.style;
  $('[data-studio-stand]', studio)!.innerHTML = standObj(brand);
  $('[data-studio-phone]', studio)!.innerHTML = phone(screen === 'wallet' ? walletScreen(brand) : browserScreen(brand, 8, statusFor(8)), 'phone-studio');
  for (const b of $$('[data-brand-style]', studio)) b.setAttribute('aria-pressed', String(b.dataset.brandStyle === brand.style));
  for (const b of $$('[data-brand-logo]', studio)) b.setAttribute('aria-pressed', String(b.dataset.brandLogo === brand.logo));
  const lab = $('[data-brand-label]', studio); if (lab) lab.textContent = STYLES[brand.style].label;
  const sel = $<HTMLSelectElement>('[data-brand-reward]', studio); if (sel) sel.value = brand.reward;
  if (changed) fx($('.studio-scene', studio), [{ opacity: 0.6 }, { opacity: 1 }], 240);
}
const screenTabs = $('[data-tabs="screen"]'); if (screenTabs) tabs(screenTabs, v => { screen = v === 'wallet' ? 'wallet' : 'karte'; renderStudio(true); });
studio.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-brand-style],[data-brand-logo]'); if (!t) return;
  const next = { ...brand };
  if (isStyle(t.dataset.brandStyle)) next.style = t.dataset.brandStyle; if (isLogo(t.dataset.brandLogo)) next.logo = t.dataset.brandLogo;
  if (next.style === brand.style && next.logo === brand.logo) return;
  const flooded = flood(t);
  brand = next; renderStudio(!flooded);
});
$('[data-brand-reward]', studio)?.addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; if (isReward(v) && v !== brand.reward) { brand = { ...brand, reward: v }; renderStudio(true); } });

// ---- calculator (calc.ts, unchanged maths; the fee comes from the single price source) ---------------------------------------------
const FEE = SITE.price.amount;
const KEYS: FieldKey[] = ['visits', 'basket', 'days', 'gain'];
const calc = $('[data-calc]')!;
const values: Partial<Inputs> = { ...EXAMPLE };
const touched = new Set<FieldKey>();
const inp = (k: FieldKey) => $<HTMLInputElement>(`[data-in="${k}"]`, calc)!, rng = (k: FieldKey) => $<HTMLInputElement>(`[data-range="${k}"]`, calc)!, err = (k: FieldKey) => $(`[data-err="${k}"]`, calc)!;
const chart = calc.querySelector<SVGSVGElement>('[data-chart]'), table = $('[data-table]', calc);
const complete = (): Inputs | null => KEYS.every(k => typeof values[k] === 'number') ? (values as Inputs) : null;
const out = (name: string, text: string) => { for (const e of $$(`[data-out="${name}"]`, calc)) e.textContent = text; };
const draft = (k: FieldKey, v: number) => formatNumber(v, LIMITS[k].decimals ? (v % 1 ? (k === 'basket' ? 2 : 1) : 0) : 0);
let liveTimer = 0;
function scenario(): Scenario | null { const i = complete(); return i ? compute(i, FEE) : null; }
function update() {
  const s = scenario();
  calc.classList.toggle('is-empty', !s);
  const share = $<HTMLButtonElement>('[data-calc-share]', calc); if (share) share.disabled = !s;
  if (!s) { for (const n of ['additional', 'difference', 'annualised', 'baseline', 'ratio']) out(n, '–'); out('fee', euro(FEE)); $('[data-zero-note]', calc)!.hidden = true; calc.classList.remove('is-negative'); return; }
  const pts = series(s), sc = niceScale(pts[12].scenario);
  out('additional', euro(s.additional)); out('difference', signedEuro(s.difference)); out('annualised', signedEuro(s.annualised));
  out('baseline', euro(s.baseline)); out('ratio', ratioText(s.ratio)); out('fee', euro(s.fee));
  calc.classList.toggle('is-negative', s.difference < 0);
  $('[data-zero-note]', calc)!.hidden = !(s.difference < 0);
  if (chart) { const g = chart.getBoundingClientRect().width < 520 ? COMPACT : WIDE; chart.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`); chart.innerHTML = plot({ points: pts, top: sc.top, tickStep: sc.step, active: null, geometry: g }); }
  if (table) table.innerHTML = tableHtml(pts);
  // Stamp grid: one coral stamp per 5 % of assumed increase; newly added stamps land, removed ones simply clear.
  const extra = $$('[data-stampbar] span:nth-child(n+21)', calc), n = stampCount(complete()!.gain);
  extra.forEach((el, i) => { const on = i < n, was = el.classList.contains('sb-extra'); el.classList.toggle('sb-extra', on); if (on && !was) { el.classList.remove('land'); void el.offsetWidth; el.classList.add('land'); } });
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { const live = $('[data-calc-live]', calc); if (live) live.textContent = `Beispiel: ${euro(s.additional)} zusätzlicher Monatsumsatz, Differenz nach Abogebühr ${signedEuro(s.difference)}.`; }, 700);
}
function validate(k: FieldKey, show: boolean) {
  const r = parseField(k, inp(k).value), i = inp(k);
  if (r.state === 'ok') { values[k] = r.value; i.removeAttribute('aria-invalid'); err(k).textContent = ''; }
  else { delete values[k]; i.setAttribute('aria-invalid', 'true'); err(k).textContent = show || touched.has(k) ? (r.state === 'invalid' ? r.message : 'Bitte einen Wert eingeben.') : ''; }
  return r;
}
for (const k of KEYS) {
  const i = inp(k), r = rng(k), rr = SLIDER_RANGE[k];
  i.addEventListener('input', () => { const p = validate(k, false); if (p.state === 'ok') r.value = String(Math.min(rr.max, Math.max(rr.min, p.value))); update(); });
  i.addEventListener('blur', () => { touched.add(k); const p = validate(k, true); if (p.state === 'ok') i.value = draft(k, p.value); update(); });
  r.addEventListener('input', () => { const v = Number(r.value); i.value = draft(k, v); touched.delete(k); validate(k, false); update(); });
}
$('[data-calc-reset]', calc)?.addEventListener('click', () => {
  touched.clear();
  for (const k of KEYS) { values[k] = EXAMPLE[k]; inp(k).value = draft(k, EXAMPLE[k]); rng(k).value = String(EXAMPLE[k]); inp(k).removeAttribute('aria-invalid'); err(k).textContent = ''; }
  update();
});

// ---- demo request: prepares an e-mail; nothing is sent from this page --------------------------------------------------------------
let figures: string | null = null;
function figuresText(): string | null {
  const i = complete(), s = scenario(); if (!i || !s) return null;
  return [`Käufe pro Tag: ${formatNumber(i.visits)}`, `Durchschnittlicher Einkaufswert: ${euro(i.basket, i.basket % 1 ? 2 : 0)}`, `Öffnungstage pro Monat: ${formatNumber(i.days)}`, `Angenommene Zunahme: ${formatNumber(i.gain, i.gain % 1 ? 1 : 0)} %`, `Loynara-Gebühr (Szenario): ${euro(s.fee)} / Monat / Standort`, `Zusätzlicher Monatsumsatz im Szenario: ${euro(s.additional)}`, `Differenz nach Abogebühr (Umsatz, kein Gewinn): ${signedEuro(s.difference)}`].join('\n');
}
function renderFigures() { const line = $('#request-figures'), text = $('#request-figures-text'); if (line && text) { line.hidden = !figures; text.textContent = 'Deine Rechenbeispiel-Zahlen werden an die E-Mail angehängt.'; } }
const shareBtn = $<HTMLButtonElement>('[data-calc-share]', calc);
shareBtn?.addEventListener('click', () => {
  figures = figuresText(); renderFigures();
  const live = $('[data-calc-live]', calc); if (live) live.textContent = figures ? 'Zahlen für die Anfrage übernommen. Sie stehen im Anfrageformular und lassen sich dort entfernen.' : 'Bitte zuerst gültige Zahlen eingeben.';
  if (figures) shareBtn.textContent = 'Zahlen übernommen ✓';
});
$('#request-figures-remove')?.addEventListener('click', () => { figures = null; renderFigures(); if (shareBtn) shareBtn.textContent = 'Diese Zahlen in meiner Anfrage übernehmen'; });
const form = $<HTMLFormElement>('#request-form');
if (form) {
  const status = $('#request-status')!, copy = $<HTMLButtonElement>('#request-copy')!, business = $<HTMLInputElement>('#req-business')!;
  const fields = () => ({ business: business.value, industry: $<HTMLSelectElement>('#req-industry')!.value, message: $<HTMLTextAreaElement>('#req-message')!.value, figures: figures ?? undefined });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const request = buildRequest(fields());
    if (!request) { status.setAttribute('role', 'alert'); status.textContent = 'Bitte gib den Namen deines Geschäfts an.'; business.setAttribute('aria-invalid', 'true'); business.focus(); return; }
    business.removeAttribute('aria-invalid');
    status.setAttribute('role', 'status'); status.textContent = `Dein E-Mail-Programm öffnet eine Nachricht an ${SITE.supportEmail}. Gesendet ist noch nichts: Bitte prüfe den Text und klicke dort auf „Senden“. Öffnet sich nichts, kopiere den Text und schreib uns direkt.`;
    copy.hidden = false;
    window.location.href = request.mailto;
  });
  copy.addEventListener('click', async () => {
    const request = buildRequest(fields()); if (!request) return;
    try { await navigator.clipboard.writeText(`An: ${SITE.supportEmail}\nBetreff: ${request.subject}\n\n${request.body}`); status.textContent = `Text kopiert. Füge ihn in eine E-Mail an ${SITE.supportEmail} ein.`; }
    catch { status.textContent = `Kopieren war nicht möglich. Schreib uns bitte direkt an ${SITE.supportEmail}.`; }
  });
}

renderVisit(); renderRef(); renderStudio(); update(); renderFigures();

// ---- motion: play when seen ----------------------------------------------------------------------------------------------------------
// boot.js set html.js, so CSS holds every entrance at its first frame. The hero plays once 45 % of it is visible and the fonts are
// ready; sections play when they enter the lower part of the viewport and lose their entrance rules afterwards (data-done), so
// demo re-renders never replay them. The final picture is the CSS base: no JS and reduced motion show it directly.
document.documentElement.classList.add('app');
const seen = (el: Element, init: IntersectionObserverInit, run: () => void) => {
  if (!('IntersectionObserver' in window)) { run(); return; }
  const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { io.disconnect(); run(); } }, init);
  io.observe(el);
};
const heroScene = $('.hero-scene');
if (heroScene) seen(heroScene, { threshold: 0.45 }, () => document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => { heroScene.dataset.play = ''; }))));
// Any click ends the entrances that are already playing, so a demo re-render never replays them (capture phase: before the handlers render).
addEventListener('click', () => { for (const e of $$('[data-reveal][data-seen]')) e.dataset.done = ''; }, true);
// Hero depth (fine pointers only, never under reduced motion): stand, phone and cue drift at different depths toward the cursor.
// One rAF loop with a lerp that sleeps once settled; it writes two CSS variables, the transforms live in CSS.
if (heroScene && matchMedia('(pointer: fine)').matches && !calm()) {
  const hero = $('#hero')!; let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  const tick = () => { x += (tx - x) * 0.08; y += (ty - y) * 0.08; heroScene.style.setProperty('--px', x.toFixed(4)); heroScene.style.setProperty('--py', y.toFixed(4)); raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(tick) : 0; };
  const aim = (nx: number, ny: number) => { tx = Math.max(-1, Math.min(1, nx)); ty = Math.max(-1, Math.min(1, ny)); if (!raf) raf = requestAnimationFrame(tick); };
  hero.addEventListener('pointermove', e => { const r = heroScene.getBoundingClientRect(); aim((e.clientX - r.left - r.width / 2) / (r.width / 2), (e.clientY - r.top - r.height / 2) / (r.height / 2)); });
  hero.addEventListener('pointerleave', () => aim(0, 0));
}
for (const sec of $$('[data-reveal]')) seen(sec, { rootMargin: '0px 0px -22% 0px' }, () => { sec.dataset.seen = ''; setTimeout(() => { sec.dataset.done = ''; }, 2800); });
addEventListener('resize', () => update());
// Motion clips: play while visible, pause outside, never under reduced motion (the poster stays). In a demo section any button hands over to the live demo.
for (const fig of $$('[data-clip]')) {
  const v = $<HTMLVideoElement>('video', fig)!;
  if (!calm() && 'IntersectionObserver' in window) new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { threshold: 0.25 }).observe(fig);
  if (fig.dataset.clip !== 'hero') fig.closest('section')!.addEventListener('click', e => { if ((e.target as Element).closest('button')) { v.pause(); fig.hidden = true; } });
}
