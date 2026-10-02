import { animate, inView } from 'motion';
import { SITE, DEMO, industries, isIndustryKey, type IndustryKey } from './site.js';
import { initialDemo, transition, viewOf, enterChapter, type Chapter, type DemoAction, type DemoState } from './demo.js';
import { initialRef, refTransition, type RefAction, type RefState } from './ref.js';
import { initialBrand, isLogo, isReward, isStyle, rewardText, LOGOS, STYLES, type BrandState } from './brand.js';
import { OWNER_VIEWS, growthStrip, journeyStage, journeyStrip, loyCard, ownerBody, standSvg, studioComposition, type OwnerView } from './views.js';
import { EXAMPLE, LIMITS, SLIDER_RANGE, compute, series, parseField, euro, signedEuro, ratioText, formatNumber, niceScale, type FieldKey, type Inputs, type Scenario } from './calc.js';
import { plot, tableHtml, readoutHtml, monthAtX, WIDE, COMPACT, type Geometry } from './chart.js';
import { buildRequest } from './request.js';

const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [...root.querySelectorAll<T>(selector)];
const EASE_OUT = [0.22, 1, 0.36, 1] as const, EASE_STATE = [0.4, 0, 0.2, 1] as const;
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => reducedQuery.matches;
document.documentElement.classList.add('js');
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Runs a transform/opacity animation unless the visitor prefers reduced motion; always leaves the element in its final state. */
function motion(el: Element | null, keyframes: Record<string, unknown>, duration: number, ease: readonly number[] = EASE_STATE, delay = 0) {
  if (!el || reduced()) return null;
  return animate(el, keyframes as never, { duration, ease: ease as never, delay });
}
const announce = (id: string, message: string) => { const node = document.getElementById(id); if (node) node.textContent = message; };

// ---- navigation -------------------------------------------------------------------------------------------------
const toggle = $<HTMLButtonElement>('#menu-toggle'), nav = $('#main-nav');
if (toggle && nav) {
  const setOpen = (open: boolean, restoreFocus = false) => { toggle.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open); if (!open && restoreFocus) toggle.focus(); };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', event => { if ((event.target as HTMLElement).closest('a')) setOpen(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && nav.classList.contains('open')) setOpen(false, true); });
}

// ---- entrance and reveals (view-only; never changes business state) -----------------------------------------------
function entrance() {
  const scene = $('.hero-scene');
  if (!scene || reduced()) return;
  const parts = [['.hero-stand', 0], ['.hero-phone', 0.1], ['.hero-cashier', 0.22], ['.hero-owner', 0.34]] as const;
  for (const [selector, delay] of parts) motion($(selector, scene), { opacity: [0, 1], transform: ['translateY(18px) scale(0.98)', 'translateY(0px) scale(1)'] }, 0.5, EASE_OUT, delay);
}
function reveals() {
  if (reduced()) return;
  const height = innerHeight;
  for (const el of $$('[data-reveal]')) {
    if (el.getBoundingClientRect().top < height) continue;       // already visible: never hidden
    el.style.opacity = '0'; el.style.transform = 'translateY(16px)';
    let done = false; let stop: (() => void) | undefined;
    stop = inView(el, () => {
      if (done) return; done = true;
      animate(el, { opacity: 1, transform: 'translateY(0px)' }, { duration: 0.45, ease: EASE_OUT as never }).then(() => { el.style.opacity = ''; el.style.transform = ''; });
      queueMicrotask(() => stop?.());
    }, { amount: 0.12 });
  }
}
entrance(); reveals();
/** Printing must never hide content that has not been scrolled into view yet. */
addEventListener('beforeprint', () => { for (const el of $$('[data-reveal]')) { el.style.opacity = ''; el.style.transform = ''; } });

// ---- state: view selection, loyalty example, referral example, owner view, branding are separate ---------------------------------
let industry: IndustryKey = 'cafe';
let demo: DemoState = initialDemo();
let ref: RefState = initialRef();
let brand: BrandState = initialBrand();
let chapter: Chapter = 'start';
let ownerView: OwnerView = 'overview';
let ownerRevealed = false;
const stageEl = $('#demo-screens');
const MESSAGES: Record<string, string> = {
  open: 'Karte geöffnet. Die Anfrage liegt an der Kasse.', enroll: 'Karte erstellt. Die Anfrage liegt an der Kasse.', confirm: 'Besuch bestätigt, ein Stempel vergeben.',
  redeem: 'Prämie eingelöst. Neuer Stand: 0 von 10.', reset: 'Beispiel zurückgesetzt.', fixture: 'Bestandskarte geladen: 8 von 10.',
  'ref-share': 'Empfehlungslink geteilt – Beispiel, nichts wurde versendet.', 'ref-open': 'Der Freund hat den Link geöffnet. Es wurde noch nichts verbucht.',
  'ref-join': 'Der Freund hat sich angemeldet: Karte mit 0 von 10, Teilnahme offen.', 'ref-confirm': 'Erster Besuch des Freundes bestätigt. Der Bonus wurde einmal verbucht.',
};
const panelToHighlight = (s: DemoState) => ({ start: 'customer', enroll: 'customer', confirmed: 'customer', request: 'cashier', request2: 'cashier', reward: 'cashier', redeemed: 'owner' }[s.phase]);

function flyMarker(from: DOMRect | null, toEl: Element | null) {
  const marker = $<HTMLElement>('.marker'), stage = $('#stage');
  if (!marker || !from || !toEl || !stage || reduced()) return;
  const s = stage.getBoundingClientRect(), t = toEl.getBoundingClientRect();
  const x0 = from.left + from.width / 2 - s.left, y0 = from.top + from.height / 2 - s.top, x1 = t.left + t.width / 2 - s.left, y1 = t.top + t.height / 2 - s.top;
  marker.style.left = '0'; marker.style.top = '0';
  animate(marker, { opacity: [1, 1, 0], transform: [`translate(${x0}px, ${y0}px) scale(1)`, `translate(${x1}px, ${y1}px) scale(1.15)`, `translate(${x1}px, ${y1}px) scale(0.6)`] }, { duration: 0.4, ease: EASE_STATE as never, times: [0, 0.8, 1] });
}

function renderTabs() {
  $$('[data-chapter]').forEach(t => { const on = t.dataset.chapter === chapter; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
  $('#journey-panel')?.setAttribute('aria-labelledby', `tab-${chapter}`);
  const g = $('#growth'); if (g) g.innerHTML = growthStrip(chapter, ref.phase === 'qualified');
}
function renderStrip() {
  const s = journeyStrip(chapter, demo, ref);
  const i = $('#strip-instruction'), r = $('#strip-result'); if (i) i.textContent = s.instruction; if (r) r.textContent = s.result;
}
function renderJourney(prevDemo?: DemoState, fromRect: DOMRect | null = null) {
  if (!stageEl) return;
  const focused = (document.activeElement as HTMLElement | null)?.closest?.('#demo-screens [data-action]')?.getAttribute('data-action') ?? null;
  const hadFocus = stageEl.contains(document.activeElement);
  stageEl.innerHTML = journeyStage(chapter, demo, ref, industry, brand, true);
  renderTabs(); renderStrip();
  if (chapter !== 'refer') {
    $$('.panel', stageEl).forEach(p => p.classList.toggle('is-active', p.dataset.panel === panelToHighlight(demo)));
    const v = viewOf(demo), before = prevDemo ? viewOf(prevDemo) : v;
    if (v.balance > before.balance) {
      const el = $('[data-balance]', stageEl);
      if (el && el.firstChild && !reduced()) { const node = el.firstChild; animate(before.balance, v.balance, { duration: 0.3, ease: EASE_STATE as never, onUpdate: (n: number) => { node.nodeValue = String(Math.round(n)); } }); }
      const fresh = $$('.stamp', stageEl)[v.balance - 1]; if (fresh) motion(fresh, { transform: ['scale(0.4)', 'scale(1.08)', 'scale(1)'], opacity: [0, 1] }, 0.34, EASE_OUT);
    }
    if (prevDemo && prevDemo.phase !== demo.phase) {
      if (demo.phase === 'confirmed' || demo.phase === 'reward') flyMarker(fromRect, $(demo.phase === 'confirmed' ? '.panel-customer .loy-card' : '.panel-owner', stageEl));
      $$('.panel.is-active', stageEl).forEach(p => motion(p, { transform: ['translateY(6px)', 'translateY(0px)'] }, 0.26, EASE_OUT));
    }
  } else { $$('.panel.is-active', stageEl).forEach(p => motion(p, { transform: ['translateY(6px)', 'translateY(0px)'] }, 0.26, EASE_OUT)); }
  if (hadFocus) ((focused && $<HTMLElement>(`[data-action="${focused}"]`, stageEl)) || $<HTMLElement>('[data-next]', stageEl) || $<HTMLElement>('#demo-reset'))?.focus({ preventScroll: true });
}
/** After an explicit action, scroll only as far as needed so the next control (or the result) is fully visible below the sticky header. */
function keepNextVisible() {
  if (!stageEl) return;
  const target = $('[data-next]', stageEl) ?? $('.panel.is-active', stageEl);
  if (!target) return;
  const header = ($('.header')?.getBoundingClientRect().height ?? 72) + 16, r = target.getBoundingClientRect();
  const delta = r.top < header ? r.top - header - 8 : r.bottom > innerHeight - 16 ? Math.min(r.bottom - innerHeight + 28, r.top - header - 8) : 0;
  if (Math.abs(delta) > 1) scrollBy({ top: delta, behavior: reduced() ? 'auto' : 'smooth' });
}
function actDemo(action: DemoAction, fromEl?: Element | null, key = action.type) {
  const prev = demo, fromRect = fromEl?.getBoundingClientRect() ?? null;
  demo = transition(demo, action);
  if (demo === prev) return;
  renderJourney(prev, fromRect); keepNextVisible();
  const m = MESSAGES[key]; if (m) announce('demo-announcement', m);
}
function actRef(action: RefAction, fromEl?: Element | null) {
  const prev = ref; ref = refTransition(ref, action);
  if (ref === prev) return;
  renderJourney(undefined, fromEl?.getBoundingClientRect() ?? null); keepNextVisible();
  announce('demo-announcement', MESSAGES[`ref-${action}`] ?? '');
}
/** Chapter selection is a view change: it never executes a visit, a redemption or a referral. */
function selectChapter(c: Chapter) {
  if (c === chapter) return;
  chapter = c;
  if (c !== 'refer') demo = enterChapter(demo, c);
  renderJourney();
}
stageEl?.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!button) return;
  switch (button.dataset.action) {
    case 'identity-returning': return actDemo({ type: 'identity', identity: 'returning' });
    case 'identity-new': return actDemo({ type: 'identity', identity: 'new' });
    case 'open-nfc': actDemo({ type: 'entry', entry: 'nfc' }); return actDemo({ type: 'open' }, button);
    case 'open-qr': actDemo({ type: 'entry', entry: 'qr' }); return actDemo({ type: 'open' }, button);
    case 'enroll': return actDemo({ type: 'enroll' }, button);
    case 'confirm': return actDemo({ type: 'confirm' }, button);
    case 'redeem': return actDemo({ type: 'redeem' }, button);
    case 'use-returning': { const prev = demo; demo = enterChapter(initialDemo('returning'), chapter); if (demo !== prev) { renderJourney(prev); keepNextVisible(); announce('demo-announcement', MESSAGES.fixture); } return; }
    case 'ref-share': return actRef('share', button);
    case 'ref-open': return actRef('open', button);
    case 'ref-join': return actRef('join', button);
    case 'ref-confirm': return actRef('confirm', button);
  }
});
$('#demo-reset')?.addEventListener('click', () => {
  if (chapter === 'refer') ref = refTransition(ref, 'reset'); else demo = enterChapter(initialDemo(demo.identity), chapter);
  renderJourney(); announce('demo-announcement', MESSAGES.reset);
});
/** Tabs: roving tabindex, arrow/Home/End keys; focus stays on the selected tab and is never moved into the panel. */
function tabKeys(selector: string, ids: string[], select: (id: string) => void) {
  const tabs = $$(selector);
  tabs.forEach(t => t.addEventListener('keydown', e => {
    const i = tabs.indexOf(t); let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = tabs.length - 1; else return;
    e.preventDefault(); select(ids[n]); tabs[n].focus();
  }));
}
const chapterIds = ['start', 'collect', 'reward', 'refer'];
$$('[data-chapter]').forEach(t => t.addEventListener('click', () => selectChapter(t.dataset.chapter as Chapter)));
tabKeys('[data-chapter]', chapterIds, id => selectChapter(id as Chapter));

// ---- industry selection --------------------------------------------------------------------------------------------
const select = $<HTMLSelectElement>('#industry-select');
function setIndustry(key: IndustryKey, speak = true) {
  const changed = key !== industry; industry = key;
  document.body.dataset.industry = key;
  $$('[data-industry-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.industryChoice === key)));
  if (select) select.value = key;
  if (changed) {
    demo = enterChapter(initialDemo(demo.identity), chapter === 'refer' ? 'start' : chapter);   // the loyalty example is industry-specific; the referral and branding states are kept
    const note = $('#industry-note'); if (note) { note.hidden = !speak; note.textContent = `Branche gewechselt: Name, Prämie und Beispielkarte passen sich an, der Karten-Beispielstand beginnt von vorn. Dein Rechenbeispiel bleibt unverändert.`; }
  }
  renderJourney(); renderOwner(false); renderBrand();
  if (speak) announce('demo-announcement', `${industries[key].label} gewählt. Das Karten-Beispiel beginnt von vorn.`);
}
$$('[data-industry-choice]').forEach(b => b.addEventListener('click', () => { const key = b.dataset.industryChoice; if (isIndustryKey(key) && key !== industry) setIndustry(key); }));
select?.addEventListener('change', () => { if (isIndustryKey(select.value) && select.value !== industry) setIndustry(select.value); });

// ---- owner workspace ---------------------------------------------------------------------------------------------------
function renderOwner(animateIt = true) {
  const v = OWNER_VIEWS.find(x => x.id === ownerView)!;
  $$('[data-owner-view]').forEach(t => { const on = t.dataset.ownerView === ownerView; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
  $('#owner-panel')?.setAttribute('aria-labelledby', `otab-${ownerView}`);
  const body = $('#owner-body'), actions = $('#owner-actions'), action = $<HTMLButtonElement>('#owner-action');
  if (body) body.innerHTML = ownerBody(ownerView, industry, ownerRevealed);
  if (actions) actions.hidden = !v.outlook;
  if (action) { action.textContent = ownerRevealed ? 'Vorschau ausblenden' : v.cta; action.setAttribute('aria-expanded', String(ownerRevealed)); }
  const name = $('.owner-merchant b'); if (name) name.textContent = industries[industry].name;
  if (animateIt) motion(body, { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0px)'] }, 0.26, EASE_OUT);
}
const ownerIds = ['overview', 'quiet', 'win'];
function selectOwner(id: string) { if (id === ownerView) return; ownerView = id as OwnerView; ownerRevealed = false; renderOwner(); }
$$('[data-owner-view]').forEach(t => t.addEventListener('click', () => selectOwner(t.dataset.ownerView!)));
tabKeys('[data-owner-view]', ownerIds, selectOwner);
$('#owner-action')?.addEventListener('click', () => { ownerRevealed = !ownerRevealed; renderOwner(false); if (ownerRevealed) motion($('.message', $('#owner-body')!), { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0px)'] }, 0.3, EASE_OUT); });

// ---- branding studio (page memory only; independent of loyalty, referral and calculator state) -------------------------------
function renderBrand() {
  document.documentElement.dataset.brandStyle = brand.style;
  $$('button[data-brand-style]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.brandStyle === brand.style)));
  $$('button[data-brand-logo]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.brandLogo === brand.logo)));
  $$('button[data-brand-reward]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.brandReward === brand.reward)));
  const ls = $('#lbl-style'), ll = $('#lbl-logo'); if (ls) ls.textContent = STYLES[brand.style].label; if (ll) ll.textContent = LOGOS[brand.logo].label;
  const comp = $('#studio-comp'); if (comp) comp.innerHTML = studioComposition(brand, industry);
  const mini = $('.sm-visual'); if (mini) mini.innerHTML = standSvg(brand, industries[industry].name, 'sm') + loyCard({ balance: 8, threshold: 10, status: 'Noch 2 bis zur Prämie', name: industries[industry].name, reward: rewardText(brand, industry), brand, mini: true });
  renderJourney();
}
$('#studio')?.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-brand-style],[data-brand-logo],[data-brand-reward]'); if (!t) return;
  const next = { ...brand };
  if (isStyle(t.dataset.brandStyle)) next.style = t.dataset.brandStyle; if (isLogo(t.dataset.brandLogo)) next.logo = t.dataset.brandLogo; if (isReward(t.dataset.brandReward)) next.reward = t.dataset.brandReward;
  if (next.style === brand.style && next.logo === brand.logo && next.reward === brand.reward) return;
  brand = next; renderBrand();
  const comp = $('#studio-comp'); if (comp) motion(comp, { opacity: [0.6, 1] }, 0.24, EASE_STATE);
});

// ---- calculator --------------------------------------------------------------------------------------------------------
const FEE = SITE.price.amount;
const keys = Object.keys(LIMITS) as FieldKey[];
const inputEl = (k: FieldKey) => $<HTMLInputElement>(`#in-${k}`)!, rangeEl = (k: FieldKey) => $<HTMLInputElement>(`#rg-${k}`)!, errEl = (k: FieldKey) => $(`#err-${k}`)!;
const touched = new Set<FieldKey>();
const values: Partial<Record<FieldKey, number>> = { ...EXAMPLE };
let chartActive: number | null = null;
let geom: Geometry = WIDE;
let shown = { baseline: 0, additional: 0, top: 1000 };       // what the chart currently draws (retargeted by every change)
let shownScale = niceScale(0);
let tweenHandle: { stop: () => void } | null = null;
let dragging = false;
const numberTweens = new Map<HTMLElement, { stop: () => void; value: number }>();

const draftText = (k: FieldKey, v: number) => formatNumber(v, LIMITS[k].decimals ? (v % 1 ? (k === 'basket' ? 2 : 1) : 0) : 0);
const complete = (): Inputs | null => keys.every(k => typeof values[k] === 'number') ? (values as Inputs) : null;

function currentScenario(): Scenario | null { const i = complete(); return i ? compute(i, FEE) : null; }
function setOut(name: string, text: string, numeric?: { from: number; to: number; fmt: (n: number) => string }) {
  const el = $<HTMLElement>(`[data-out="${name}"]`); if (!el) return;
  const running = numberTweens.get(el); running?.stop();
  if (!numeric || dragging || reduced()) { el.textContent = text; numberTweens.delete(el); return; }
  const from = running?.value ?? numeric.from;
  const handle = animate(from, numeric.to, { duration: 0.22, ease: EASE_STATE as never, onUpdate: (n: number) => { el.textContent = numeric.fmt(n); const t = numberTweens.get(el); if (t) t.value = n; }, onComplete: () => { el.textContent = text; numberTweens.delete(el); } });
  numberTweens.set(el, { stop: () => handle.stop(), value: from });
}
let lastOut: Scenario | null = currentScenario();
function showOutputs(s: Scenario | null) {
  const panel = $('#calc-primary'), breakdown = $('#calc-breakdown'), graph = $('#calc-graph');
  const ok = !!s;
  panel?.classList.toggle('is-stale', !ok); breakdown?.classList.toggle('is-stale', !ok); graph?.classList.toggle('is-stale', !ok);
  const empty = $('#calc-empty'); if (empty) empty.hidden = ok;
  $('#out-additional')?.setAttribute('aria-hidden', String(!ok));
  if (!s) { for (const n of ['additional', 'baseline', 'fee', 'difference', 'annualised', 'ratio']) setOut(n, n === 'fee' ? euro(FEE) : '–'); lastOut = null; return; }
  const p = lastOut;
  setOut('additional', euro(s.additional), { from: p?.additional ?? s.additional, to: s.additional, fmt: n => euro(Math.round(n)) });
  setOut('baseline', euro(s.baseline), { from: p?.baseline ?? s.baseline, to: s.baseline, fmt: n => euro(Math.round(n)) });
  setOut('fee', euro(s.fee));
  setOut('difference', signedEuro(s.difference), { from: p?.difference ?? s.difference, to: s.difference, fmt: n => signedEuro(Math.round(n)) });
  setOut('annualised', euro(s.annualised), { from: p?.annualised ?? s.annualised, to: s.annualised, fmt: n => euro(Math.round(n)) });
  setOut('ratio', ratioText(s.ratio));
  lastOut = s;
}

function scenarioFrom(baseline: number, additional: number): Scenario { return { fee: FEE, baseline, additional, scenario: baseline + additional, difference: additional - FEE, annualised: (additional - FEE) * 12, ratio: null }; }
function drawChart() {
  const g = $('#chart-plot'); if (!g) return;
  const pts = series(scenarioFrom(shown.baseline, shown.additional));
  g.innerHTML = plot({ points: pts, top: shown.top, tickStep: shownScale.step, active: chartActive, geometry: geom });
  positionTip(pts);
}
function settleTable(s: Scenario | null) { const t = $('#chart-table'); if (t && s) t.innerHTML = tableHtml(series(s)); }
function retargetChart(s: Scenario | null, immediate: boolean) {
  tweenHandle?.stop(); tweenHandle = null;
  if (!s) { return; }
  const pts = series(s), target = niceScale(Math.max(pts[12].scenario, pts[12].baseline)), from = { ...shown };
  shownScale = target;
  const to = { baseline: s.baseline, additional: s.additional, top: target.top };
  settleTable(s);
  if (immediate || dragging || reduced()) { shown = to; drawChart(); return; }
  const handle = animate(0, 1, { duration: 0.22, ease: EASE_STATE as never, onUpdate: (p: number) => {
    shown = { baseline: from.baseline + (to.baseline - from.baseline) * p, additional: from.additional + (to.additional - from.additional) * p, top: from.top + (to.top - from.top) * p };
    drawChart();
  }, onComplete: () => { shown = to; drawChart(); } });
  tweenHandle = { stop: () => handle.stop() };
}

// month inspection: a fixed readout strip above the plot (never covers the data); hover, touch and keyboard are equivalent
const readout = $('#chart-readout'), wrap = $('#chart-wrap'), svg = $<SVGSVGElement>('#chart');
function positionTip(pts = series(scenarioFrom(shown.baseline, shown.additional))) {
  if (!readout) return;
  readout.innerHTML = readoutHtml(pts[chartActive ?? 12], chartActive === null);
}
function inspect(month: number | null, speak = false) {
  chartActive = month; drawChart();
  if (speak && month !== null) { const p = series(scenarioFrom(shown.baseline, shown.additional))[month]; announce('chart-announce', `Monat ${month}: ohne Steigerung ${euro(p.baseline)}, mit Steigerung ${euro(p.scenario)}, Differenz ${euro(p.gap)}.`); }
}
const hit = $('#chart-hit');
hit?.addEventListener('pointermove', e => inspect(monthAtX(e.clientX, svg!.getBoundingClientRect(), geom)));
hit?.addEventListener('pointerdown', e => inspect(monthAtX(e.clientX, svg!.getBoundingClientRect(), geom)));
hit?.addEventListener('pointerleave', e => { if ((e as PointerEvent).pointerType === 'mouse') inspect(null); });
svg?.addEventListener('focus', () => { if (chartActive === null) inspect(12, true); });
svg?.addEventListener('blur', () => inspect(null));
svg?.addEventListener('keydown', e => {
  const cur = chartActive ?? 12; let next = cur;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(12, cur + 1); else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, cur - 1);
  else if (e.key === 'Home') next = 0; else if (e.key === 'End') next = 12; else if (e.key === 'Escape') { inspect(null); return; } else return;
  e.preventDefault(); inspect(next, true);
});
document.addEventListener('pointerdown', e => { if (chartActive !== null && wrap && !wrap.contains(e.target as Node)) inspect(null); });
function applyGeometry() {
  const next = (wrap?.clientWidth ?? 640) < 520 ? COMPACT : WIDE;
  if (next === geom) return;
  geom = next;
  svg?.setAttribute('viewBox', `0 0 ${geom.width} ${geom.height}`);
  const hitEl = $('#chart-hit');
  if (hitEl) { hitEl.setAttribute('x', String(geom.left)); hitEl.setAttribute('y', String(geom.top)); hitEl.setAttribute('width', String(geom.width - geom.left - geom.right)); hitEl.setAttribute('height', String(geom.height - geom.top - geom.bottom)); }
  drawChart();
}
addEventListener('resize', () => { applyGeometry(); positionTip(); });

let announceTimer: number | undefined;
function update(immediate = false) {
  const s = currentScenario();
  showOutputs(s);
  retargetChart(s, immediate);
  const help = $('#chart-help'); if (help) { help.dataset.base ??= help.textContent ?? ''; help.textContent = s && s.additional === 0 ? `${help.dataset.base} Bei 0 % Zunahme liegen beide Linien übereinander.` : help.dataset.base; }
  const share = $<HTMLButtonElement>('#calc-share'); if (share) share.disabled = !s;
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => announce('calc-announcement', s ? `Beispiel: ${euro(s.additional)} zusätzlicher Monatsumsatz, Differenz nach Abogebühr ${signedEuro(s.difference)}.` : 'Bitte alle Felder mit gültigen Zahlen füllen.'), 700);
}
function validate(k: FieldKey, text: string, showMessage: boolean) {
  const r = parseField(k, text), input = inputEl(k), err = errEl(k);
  if (r.state === 'ok') { values[k] = r.value; input.removeAttribute('aria-invalid'); err.textContent = ''; }
  else {
    delete values[k]; input.setAttribute('aria-invalid', 'true');
    err.textContent = showMessage || touched.has(k) ? (r.state === 'invalid' ? r.message : 'Bitte einen Wert eingeben.') : '';
  }
  return r;
}
for (const k of keys) {
  const input = inputEl(k), range = rangeEl(k), limits = LIMITS[k], rr = SLIDER_RANGE[k];
  input.addEventListener('input', () => {
    const r = validate(k, input.value, false);
    if (r.state === 'ok') range.value = String(clamp(r.value, rr.min, rr.max));
    update();
  });
  input.addEventListener('blur', () => {
    touched.add(k);
    const r = validate(k, input.value, true);
    if (r.state === 'ok') input.value = draftText(k, r.value);
    update(true);
  });
  const onRange = () => { const v = Number(range.value); input.value = draftText(k, v); touched.delete(k); validate(k, input.value, false); update(); };
  range.addEventListener('input', onRange);
  range.addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { if (dragging) { dragging = false; update(true); } });
  addEventListener('pointercancel', () => { if (dragging) { dragging = false; update(true); } });
  void limits;
}
$('#calc-reset')?.addEventListener('click', () => {
  touched.clear();
  for (const k of keys) { values[k] = EXAMPLE[k]; inputEl(k).value = draftText(k, EXAMPLE[k]); rangeEl(k).value = String(EXAMPLE[k]); inputEl(k).removeAttribute('aria-invalid'); errEl(k).textContent = ''; }
  update(); announce('calc-announcement', 'Beispielwerte wiederhergestellt.');
});
shown = (() => { const s = currentScenario()!; const sc = niceScale(s.scenario * 12); shownScale = sc; return { baseline: s.baseline, additional: s.additional, top: sc.top }; })();

// ---- demo request: prepares an e-mail; nothing is sent from this page ------------------------------------------------------
let figures: string | null = null;
const form = $<HTMLFormElement>('#request-form');
function figuresText(): string | null {
  const i = complete(), s = currentScenario(); if (!i || !s) return null;
  return [`Käufe pro Tag: ${formatNumber(i.visits)}`, `Durchschnittlicher Einkaufswert: ${euro(i.basket, i.basket % 1 ? 2 : 0)}`, `Öffnungstage pro Monat: ${formatNumber(i.days)}`, `Angenommene Zunahme: ${formatNumber(i.gain, i.gain % 1 ? 1 : 0)} %`, `Loynara-Gebühr (Szenario): ${euro(s.fee)} / Monat / Standort`, `Zusätzlicher Monatsumsatz im Szenario: ${euro(s.additional)}`, `Differenz nach Abogebühr (Umsatz, kein Gewinn): ${signedEuro(s.difference)}`].join('\n');
}
function renderFigures() {
  const line = $('#request-figures'), text = $('#request-figures-text');
  if (line && text) { line.hidden = !figures; text.textContent = 'Deine Rechenbeispiel-Zahlen werden an die E-Mail angehängt.'; }
}
$('#calc-share')?.addEventListener('click', () => {
  figures = figuresText(); renderFigures();
  announce('calc-announcement', figures ? 'Zahlen für die Anfrage übernommen. Sie stehen im Anfrageformular und lassen sich dort entfernen.' : 'Bitte zuerst gültige Zahlen eingeben.');
  const b = $<HTMLButtonElement>('#calc-share'); if (b && figures) b.textContent = 'Zahlen übernommen ✓';
});
$('#request-figures-remove')?.addEventListener('click', () => { figures = null; renderFigures(); const b = $<HTMLButtonElement>('#calc-share'); if (b) b.textContent = 'Diese Zahlen in meiner Anfrage übernehmen'; });
if (form) {
  const status = $('#request-status'), copy = $<HTMLButtonElement>('#request-copy');
  const fields = () => ({ business: $<HTMLInputElement>('#req-business')!.value, industry: $<HTMLSelectElement>('#req-industry')!.value, message: $<HTMLTextAreaElement>('#req-message')!.value, figures: figures ?? undefined });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const request = buildRequest(fields());
    if (!request) { if (status) { status.setAttribute('role', 'alert'); status.textContent = 'Bitte gib den Namen deines Geschäfts an.'; } $('#req-business')?.setAttribute('aria-invalid', 'true'); $('#req-business')?.focus(); return; }
    $('#req-business')?.removeAttribute('aria-invalid');
    if (status) { status.setAttribute('role', 'status'); status.textContent = `Dein E-Mail-Programm öffnet eine Nachricht an ${SITE.supportEmail}. Gesendet ist noch nichts: Bitte prüfe den Text und klicke dort auf „Senden“. Öffnet sich nichts, kopiere den Text und schreib uns direkt.`; }
    if (copy) copy.hidden = false;
    window.location.href = request.mailto;
  });
  copy?.addEventListener('click', async () => {
    const request = buildRequest(fields()); if (!request) return;
    try { await navigator.clipboard.writeText(`An: ${SITE.supportEmail}\nBetreff: ${request.subject}\n\n${request.body}`); if (status) status.textContent = `Text kopiert. Füge ihn in eine E-Mail an ${SITE.supportEmail} ein.`; }
    catch { if (status) status.textContent = `Kopieren war nicht möglich. Schreib uns bitte direkt an ${SITE.supportEmail}.`; }
  });
}
void DEMO; void EXAMPLE;
renderTabs(); renderOwner(false); renderBrand();
applyGeometry();
update(true);
