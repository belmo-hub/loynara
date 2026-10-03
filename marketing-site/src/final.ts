/**
 * Browser wiring for the final marketing page. Everything lives in page memory: no network, no storage.
 * The tested state machines (demo.ts, ref.ts), brand state (brand.ts) and calculator maths (calc.ts) are reused unchanged.
 * Selecting a tab only changes the view; it never runs a business action.
 */
import { animate } from 'motion';
import { initialDemo, transition, viewOf, type DemoState } from './demo.js';
import { initialRef, refTransition, refView, REF_RULE, type RefAction, type RefState } from './ref.js';
import { initialBrand, isLogo, isReward, isStyle, STYLES, type BrandState } from './brand.js';
import { LIMITS, SLIDER_RANGE, compute, euro, formatNumber, niceScale, parseField, ratioText, series, signedEuro, type FieldKey, type Inputs, type Scenario, EXAMPLE } from './calc.js';
import { plot, tableHtml, COMPACT, WIDE } from './chart.js';
import { buildRequest } from './request.js';
import { SITE } from './site.js';
import { cardHtml, statusFor, studioHtml } from './final-parts.js';

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
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
for (const id of ['stage', 'owner']) { const list = $(`[data-tabs="${id}"]`); if (list) tabs(list, v => showView(id, v)); }

// ---- product stage: visit, reward (demo.ts) and referral (ref.ts) ---------------------------------------------------------------
const stage = $('#stage')!;
let brand: BrandState = initialBrand();
const visit0 = (): DemoState => transition(initialDemo('returning'), { type: 'open' });          // card open, request pending, 8/10
const reward0 = (): DemoState => ({ phase: 'reward', entry: 'nfc', identity: 'returning', enrolled: false }); // full card, 10/10
let visit = visit0(), reward = reward0(), ref: RefState = initialRef();
const STAGE_BRAND = initialBrand();   // the stage shows the default identity; the studio below has its own brand state
const card = (slot: string, balance: number, status: string) => { const el = $(`[data-slot="${slot}"]`, stage); if (el) el.innerHTML = cardHtml({ balance, status, brand: STAGE_BRAND }); return el; };
const stamp = (slot: string, n: number) => fx($(`[data-slot="${slot}"] .lc-stamps`, stage)?.children[n - 1], [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], 320);
const button = (act: string) => $<HTMLButtonElement>(`[data-act="${act}"]`, stage)!;
const resetBtn = (act: string) => $<HTMLButtonElement>(`[data-reset="${act}"]`, stage)!;

function renderVisit(prev?: DemoState) {
  const v = viewOf(visit), done = visit.phase !== 'request';
  card('visit-card', v.balance, statusFor(v.balance));
  bind(stage, 'visit-caption', done ? 'Bestätigt – genau ein Stempel, auch bei doppeltem Tippen.' : 'Neue Anfrage an der Kasse: Beispielkarte 4217. Erst die Bestätigung zählt.');
  bind(stage, 'visit-owner', v.confirmedVisits ? `Inhaber sieht: ${plural(v.confirmedVisits, 'bestätigter Besuch', 'bestätigte Besuche')}.` : 'Inhaber sieht: noch kein bestätigter Besuch.');
  const b = button('visit'); b.disabled = done; b.textContent = done ? '✓ Besuch bestätigt' : 'Besuch bestätigen'; resetBtn('visit').hidden = !done;
  if (prev && viewOf(prev).balance < v.balance) stamp('visit-card', v.balance);
}
function renderReward() {
  const v = viewOf(reward), done = reward.phase === 'redeemed';
  card('reward-card', v.balance, statusFor(v.balance, done));
  bind(stage, 'reward-caption', done ? 'Eingelöst – genau einmal. Der Stand beginnt wieder bei null.' : 'Zehn Stempel: Es wartet ein Kaffee aufs Haus. Dein Team löst die Prämie ein – genau einmal.');
  bind(stage, 'reward-owner', v.redemptions ? `Inhaber sieht: ${plural(v.redemptions, 'eingelöste Prämie', 'eingelöste Prämien')}.` : 'Inhaber sieht: noch keine eingelöste Prämie.');
  const b = button('reward'); b.disabled = done; b.textContent = done ? '✓ Prämie eingelöst' : 'Prämie einlösen'; resetBtn('reward').hidden = !done;
}
const REF_UI: Record<string, { label: string; action: RefAction; caption: string; friend: string }> = {
  idle: { label: 'Link teilen', action: 'share', caption: 'Kunde A ist Stammkunde: 7 von 10 Stempeln. Teilen allein bringt noch keinen Bonus.', friend: 'Freund B ist noch nicht dabei.' },
  shared: { label: 'Freund öffnet den Link', action: 'open', caption: 'Der Link ist geteilt. Das bringt noch keinen Bonus.', friend: 'Freund B hat den Link noch nicht geöffnet.' },
  opened: { label: 'Freund erstellt seine Karte', action: 'join', caption: 'Freund B hat den Link geöffnet. Auch das bringt noch keinen Bonus.', friend: 'Freund B hat noch keine Karte.' },
  joined: { label: 'Ersten Besuch bestätigen', action: 'confirm', caption: 'Teilnahme offen: Erst wenn dein Team den ersten Besuch von Freund B bestätigt, zählt die Empfehlung.', friend: 'Freund B hat eine Karte (0 von 10). Der erste Besuch fehlt noch.' },
  qualified: { label: '✓ Bonus verbucht', action: 'reset', caption: `Bedingung erfüllt: +${REF_RULE.referrerBonus} Bonusstempel für Kunde A, genau einmal verbucht.`, friend: 'Freund B: erster Besuch bestätigt (1 von 10).' },
};
function renderRef(prev?: RefState) {
  const v = refView(ref), ui = REF_UI[ref.phase], done = ref.phase === 'qualified';
  card('refer-card', v.referrerBalance, done ? `+${REF_RULE.referrerBonus} Empfehlungsbonus` : statusFor(v.referrerBalance));
  bind(stage, 'refer-friend', ui.friend); bind(stage, 'refer-caption', ui.caption);
  bind(stage, 'refer-owner', done ? `Inhaber sieht: ${plural(v.qualifiedReferrals, 'qualifizierte Empfehlung', 'qualifizierte Empfehlungen')}, ${v.bonusBooked} Bonus verbucht.` : 'Inhaber sieht: noch keine qualifizierte Empfehlung.');
  $$('[data-ref-step]', stage).forEach((li, i) => li.classList.toggle('done', i <= v.step));
  const b = button('refer'); b.textContent = ui.label; b.disabled = done; resetBtn('refer').hidden = !done;
  if (prev && prev.phase !== ref.phase) { fx($('[data-slot="refer-card"]', stage), [{ opacity: 0.6 }, { opacity: 1 }], 240); if (done) stamp('refer-card', v.referrerBalance); }
}
button('visit').addEventListener('click', () => { const prev = visit; visit = transition(visit, { type: 'confirm' }); if (visit !== prev) { renderVisit(prev); say(stage, 'Besuch bestätigt. Ein Stempel hinzugefügt.'); } });
button('reward').addEventListener('click', () => { const prev = reward; reward = transition(reward, { type: 'redeem' }); if (reward !== prev) { renderReward(); say(stage, 'Prämie eingelöst.'); } });
button('refer').addEventListener('click', () => { const prev = ref; ref = refTransition(ref, REF_UI[ref.phase].action); if (ref !== prev) { renderRef(prev); say(stage, REF_UI[ref.phase].caption); } });
resetBtn('visit').addEventListener('click', () => { visit = visit0(); renderVisit(); button('visit').focus(); say(stage, 'Beispiel zurückgesetzt.'); });
resetBtn('reward').addEventListener('click', () => { reward = reward0(); renderReward(); button('reward').focus(); say(stage, 'Beispiel zurückgesetzt.'); });
resetBtn('refer').addEventListener('click', () => { ref = refTransition(ref, 'reset'); renderRef(); button('refer').focus(); say(stage, 'Beispiel zurückgesetzt.'); });

// ---- branding studio: one state for stand, card and Wallet-Vorschau (page memory only) -----------------------------------------
const studio = $('#studio')!;
let studioView: 'tresen' | 'wallet' = 'tresen';
function renderStudio() {
  studio.dataset.brand = brand.style;
  const pic = $('[data-studio]', studio)!; pic.innerHTML = studioHtml(brand, studioView);
  for (const b of $$('[data-brand-style]', studio)) b.setAttribute('aria-pressed', String(b.dataset.brandStyle === brand.style));
  for (const b of $$('[data-brand-logo]', studio)) b.setAttribute('aria-pressed', String(b.dataset.brandLogo === brand.logo));
  const lab = $('[data-brand-label]', studio); if (lab) lab.textContent = STYLES[brand.style].label;
  const sel = $<HTMLSelectElement>('[data-brand-reward]', studio); if (sel) sel.value = brand.reward;
  fx(pic, [{ opacity: 0.55 }, { opacity: 1 }], 240);
}
const studioTabs = $('[data-tabs="studio-view"]'); if (studioTabs) tabs(studioTabs, v => { studioView = v === 'wallet' ? 'wallet' : 'tresen'; renderStudio(); });
studio.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-brand-style],[data-brand-logo]'); if (!t) return;
  const next = { ...brand };
  if (isStyle(t.dataset.brandStyle)) next.style = t.dataset.brandStyle; if (isLogo(t.dataset.brandLogo)) next.logo = t.dataset.brandLogo;
  if (next.style === brand.style && next.logo === brand.logo) return;
  brand = next; renderStudio();
});
$('[data-brand-reward]', studio)?.addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; if (isReward(v) && v !== brand.reward) { brand = { ...brand, reward: v }; renderStudio(); } });

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

renderVisit(); renderReward(); renderRef(); renderStudio(); update(); renderFigures();
addEventListener('resize', () => update());
