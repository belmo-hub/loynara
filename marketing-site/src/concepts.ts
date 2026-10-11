/**
 * Browser wiring for the design-concept prototypes. Reuses the tested state machines and calculator maths unchanged
 * (demo.ts, ref.ts, calc.ts, chart.ts). Page memory only: no network, no storage.
 */
import { initialDemo, transition, viewOf, type DemoState, type DemoAction } from './demo.js';
import { initialRef, refTransition, refView, type RefState, type RefAction } from './ref.js';
import { compute, euro, parseField, ratioText, series, signedEuro, niceScale, type FieldKey, type Inputs } from './calc.js';
import { plot, tableHtml, WIDE, COMPACT } from './chart.js';
import { SITE } from './site.js';
import { cardHtml, statusFor } from './concept-parts.js';

const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fx = (el: Element | null | undefined, frames: Keyframe[], ms = 260) => { if (el && !calm()) el.animate(frames, { duration: ms, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }); };
const say = (root: Element, text: string) => { const live = root.querySelector('[data-live]'); if (live) live.textContent = text; };

// ---- tabs: roving tabindex; a view change never runs a business action -----------------------------------------
for (const list of $$('[data-tabs]')) {
  const tabs = $$<HTMLButtonElement>('[role="tab"]', list), panel = document.getElementById(list.dataset.tabs!)!;
  const select = (t: HTMLButtonElement, focus = false) => {
    for (const x of tabs) { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; }
    panel.setAttribute('aria-labelledby', t.id); panel.dataset.view = t.dataset.view;
    for (const el of $$('[data-show]', panel)) { const on = el.dataset.show!.split(' ').includes(t.dataset.view!); if (el.hidden === on) { el.hidden = !on; if (on) fx(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }]); } }
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
      if (n < 0) return; e.preventDefault(); select(tabs[n], true);
    });
  });
}

// ---- brand: one selector changes every object in its scope -------------------------------------------------------
for (const root of $$('[data-brand-root]')) {
  const picks = $$<HTMLButtonElement>('[data-brand-pick]', root), label = root.querySelector('[data-brand-label]');
  picks.forEach(b => b.addEventListener('click', () => {
    root.dataset.brand = b.dataset.brandPick;
    for (const x of picks) x.setAttribute('aria-pressed', String(x === b));
    if (label) label.textContent = b.getAttribute('aria-label');
    for (const o of $$('.stand, .lcard, .wpass', root)) fx(o, [{ opacity: 0.55 }, { opacity: 1 }], 240);
  }));
}

// ---- visit story (demo.ts) ---------------------------------------------------------------------------------------
const CYCLE: Record<string, { label: string; action: DemoAction; caption: string }> = {
  start: { label: 'Karte öffnen', action: { type: 'open' }, caption: 'Dein Kunde tippt das Schild an oder scannt den QR-Code.' },
  request: { label: 'Besuch bestätigen', action: { type: 'confirm' }, caption: 'Die Karte ist offen. Dein Team sieht die Anfrage an der Kasse.' },
  confirmed: { label: 'Nächsten Besuch zeigen', action: { type: 'nextVisit' }, caption: 'Bestätigt – genau ein Stempel. Noch ein Besuch bis zur Prämie.' },
  request2: { label: 'Besuch bestätigen', action: { type: 'confirm' }, caption: 'Ein weiterer Besuch. Wieder bestätigt dein Team.' },
  reward: { label: 'Prämie einlösen', action: { type: 'redeem' }, caption: 'Zehn Stempel: Die Prämie ist bereit.' },
  redeemed: { label: 'Von vorn', action: { type: 'reset' }, caption: 'Eingelöst. Im Überblick: zwei bestätigte Besuche, eine Prämie.' },
};
for (const root of $$('[data-visit]')) {
  const single = root.dataset.visit === 'single';
  const fresh = (): DemoState => single ? transition(initialDemo('returning'), { type: 'open' }) : initialDemo('returning');
  let s = fresh();
  const act = root.querySelector<HTMLButtonElement>('[data-visit-act]')!, reset = root.querySelector<HTMLButtonElement>('[data-visit-reset]');
  const render = (prev?: DemoState) => {
    const v = viewOf(s);
    root.dataset.phase = s.phase;
    for (const c of $$('[data-card]', root)) c.innerHTML = cardHtml({ balance: v.balance, status: statusFor(v.balance, s.phase === 'redeemed'), size: (c.dataset.card as 'lg' | 'md') || 'lg' });
    for (const b of $$('[data-bind="visits"]', root)) b.textContent = String(v.confirmedVisits);
    for (const b of $$('[data-bind="rewards"]', root)) b.textContent = String(v.redemptions);
    for (const b of $$('[data-bind="visits-label"]', root)) b.textContent = v.confirmedVisits === 1 ? 'bestätigter Besuch heute' : 'bestätigte Besuche heute';
    for (const b of $$('[data-bind="summary"]', root)) b.textContent = `${v.confirmedVisits} ${v.confirmedVisits === 1 ? 'bestätigter Besuch' : 'bestätigte Besuche'} · ${v.redemptions} ${v.redemptions === 1 ? 'Prämie' : 'Prämien'} eingelöst`;
    for (const b of $$('[data-bind="caption"]', root)) b.textContent = single ? (s.phase === 'confirmed' ? 'Bestätigt – genau ein Stempel, auch bei doppeltem Tippen.' : 'Neue Anfrage an der Kasse: Beispielkarte 4217.') : CYCLE[s.phase].caption;
    if (single) { act.disabled = s.phase !== 'request'; act.textContent = s.phase === 'request' ? 'Besuch bestätigen' : '✓ Besuch bestätigt'; if (reset) reset.hidden = s.phase === 'request'; }
    else act.textContent = CYCLE[s.phase].label;
    if (prev && v.balance > viewOf(prev).balance) for (const c of $$('[data-card]', root)) fx(c.querySelectorAll('.lc-stamps li')[v.balance - 1], [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }], 320);
    if (prev && prev.phase !== s.phase) for (const b of $$('[data-bind]', root)) fx(b, [{ opacity: 0.3 }, { opacity: 1 }], 220);
  };
  act.addEventListener('click', () => {
    const prev = s; s = single ? transition(s, { type: 'confirm' }) : transition(s, CYCLE[s.phase].action);
    if (s === prev) return; render(prev); say(root, single ? 'Besuch bestätigt. Ein Stempel hinzugefügt.' : CYCLE[s.phase].caption);
  });
  reset?.addEventListener('click', () => { s = fresh(); render(); act.focus(); say(root, 'Beispiel zurückgesetzt.'); });
  render();
}

// ---- referral story (ref.ts) --------------------------------------------------------------------------------------
const REF: Record<string, { label: string; action: RefAction; caption: string }> = {
  idle: { label: 'Link teilen', action: 'share', caption: 'Kunde A ist Stammkunde: 7 von 10 Stempeln.' },
  shared: { label: 'Freund öffnet den Link', action: 'open', caption: 'Link geteilt. Teilen allein bringt keinen Bonus.' },
  opened: { label: 'Freund erstellt seine Karte', action: 'join', caption: 'Freund B öffnet den Link – auch das zählt noch nicht.' },
  joined: { label: 'Ersten Besuch bestätigen', action: 'confirm', caption: 'Freund B hat eine Karte. Jetzt fehlt der erste bestätigte Besuch.' },
  qualified: { label: 'Von vorn', action: 'reset', caption: 'Erster Besuch bestätigt: +1 Bonusstempel für Kunde A – genau einmal.' },
};
const ORDER = ['idle', 'shared', 'opened', 'joined', 'qualified'];
for (const root of $$('[data-ref]')) {
  let r: RefState = initialRef();
  const act = root.querySelector<HTMLButtonElement>('[data-ref-act]')!;
  const render = (prev?: RefState) => {
    const v = refView(r), i = ORDER.indexOf(r.phase);
    root.dataset.phase = r.phase;
    for (const b of $$('[data-bind="a"]', root)) b.textContent = String(v.referrerBalance);
    for (const b of $$('[data-bind="b"]', root)) b.textContent = v.friendBalance === null ? '–' : String(v.friendBalance);
    for (const b of $$('[data-bind="caption"]', root)) b.textContent = REF[r.phase].caption;
    $$('[data-ref-step]', root).forEach((li, k) => { li.classList.toggle('done', i > k); li.toggleAttribute('aria-current', i === k + 1); });
    act.textContent = REF[r.phase].label;
    if (prev && prev.phase !== r.phase) { fx(root.querySelector(r.phase === 'qualified' ? '[data-token="a"]' : '[data-token="b"]'), [{ transform: 'translateY(6px) scale(.97)' }, { transform: 'none' }], 300); }
  };
  act.addEventListener('click', () => { const prev = r; r = refTransition(r, REF[r.phase].action); if (r !== prev) { render(prev); say(root, REF[r.phase].caption); } });
  render();
}

// ---- calculator (calc.ts, unchanged maths; fee from the single price source) ----------------------------------------
const KEYS: FieldKey[] = ['visits', 'basket', 'days', 'gain'];
for (const root of $$('[data-calc]')) {
  const values: Partial<Inputs> = {};
  const inp = (k: FieldKey) => root.querySelector<HTMLInputElement>(`[data-in="${k}"]`)!, rng = (k: FieldKey) => root.querySelector<HTMLInputElement>(`[data-range="${k}"]`)!, err = (k: FieldKey) => root.querySelector<HTMLElement>(`[data-err="${k}"]`)!;
  const chart = root.querySelector<SVGSVGElement>('[data-chart]'), table = root.querySelector('[data-table]');
  const out = (name: string, text: string) => { for (const e of $$(`[data-out="${name}"]`, root)) e.textContent = text; };
  const update = () => {
    const ok = KEYS.every(k => typeof values[k] === 'number');
    root.classList.toggle('is-empty', !ok);
    if (!ok) { for (const n of ['additional', 'difference', 'annualised', 'baseline', 'ratio', 'year']) out(n, '–'); return; }
    const s = compute(values as Inputs, SITE.price.amount), pts = series(s);
    out('additional', euro(s.additional)); out('difference', signedEuro(s.difference)); out('annualised', signedEuro(s.annualised));
    out('baseline', euro(s.baseline)); out('ratio', ratioText(s.ratio)); out('fee', euro(s.fee)); out('year', euro(pts[12].gap));
    root.classList.toggle('is-negative', s.difference < 0);
    if (chart) {
      const g = chart.getBoundingClientRect().width < 520 ? COMPACT : WIDE, sc = niceScale(pts[12].scenario);
      chart.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
      chart.innerHTML = plot({ points: pts, top: sc.top, tickStep: sc.step, active: null, geometry: g });
    }
    if (table) table.innerHTML = tableHtml(pts);
  };
  for (const k of KEYS) {
    const i = inp(k), r = rng(k);
    const read = (show: boolean) => { const p = parseField(k, i.value); if (p.state === 'ok') values[k] = p.value; else delete values[k]; i.setAttribute('aria-invalid', String(p.state === 'invalid' || (show && p.state === 'empty'))); err(k).textContent = p.state === 'invalid' ? p.message : show && p.state === 'empty' ? 'Bitte einen Wert eingeben.' : ''; if (p.state === 'ok') r.value = String(p.value); };
    i.addEventListener('input', () => { read(false); update(); });
    i.addEventListener('blur', () => { read(true); update(); });
    r.addEventListener('input', () => { values[k] = Number(r.value); i.value = String(r.value).replace('.', ','); i.setAttribute('aria-invalid', 'false'); err(k).textContent = ''; update(); });
    read(false);
  }
  root.querySelector('[data-calc-reset]')?.addEventListener('click', () => { for (const k of KEYS) { const v = { visits: 50, basket: 7, days: 26, gain: 10 }[k]; inp(k).value = String(v); rng(k).value = String(v); values[k] = v; err(k).textContent = ''; inp(k).setAttribute('aria-invalid', 'false'); } size(); update(); });
  const size = () => { if (root.hasAttribute('data-autosize')) for (const k of KEYS) inp(k).style.width = `${Math.max(1, inp(k).value.length) + 0.15}ch`; };
  root.addEventListener('input', size);
  for (const d of $$<HTMLDetailsElement>('details', root)) d.addEventListener('toggle', update);
  addEventListener('resize', update);
  size(); update();
}
