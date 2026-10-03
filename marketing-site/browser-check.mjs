import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// compact-v3 browser checks. Needs the loopback preview (PORT=8791 npm run marketing:preview).
// Local Chromium (system Chrome) only: no WebKit, no Safari, no physical phone, no screen reader.
const base = process.env.BASE ?? 'http://127.0.0.1:8765', out = 'marketing-site/evidence/screens';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok = true, detail = '') => { if (!ok) console.error(`FAIL: ${name} ${detail}`); assert.ok(ok, `${name} ${detail}`); results.push(name); };
const industries = ['cafe', 'barber', 'friseur', 'nagelstudio', 'gastro', 'autopflege', 'fitness', 'wellness'];
const inView = async (page, selector, height) => { for (let i = 0; i < 40; i++) { const box = await page.locator(selector).first().boundingBox(); if (box && box.y < height && box.y + box.height > 0) return true; await page.waitForTimeout(50); } return false; };
const settle = page => page.waitForTimeout(450);
const jump = (page, sel) => page.evaluate(s => document.querySelector(s).scrollIntoView({ behavior: 'instant' }), sel);
const txt = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ');

async function newPage(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, deviceScaleFactor: opts.scale ?? 1, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', javaScriptEnabled: opts.js !== false });
  const page = await context.newPage();
  const log = { problems: [], external: [], mails: [] };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => log.problems.push(`pageerror: ${e.message}`));
  page.on('request', r => { const u = r.url(); if (u.startsWith('mailto:')) log.mails.push(u); else if (!u.startsWith(base) && !u.startsWith('data:')) log.external.push(u); });
  await page.goto(base + '/');
  await page.waitForTimeout(700);
  return { page, context, log };
}
const fill = async (page, id, text) => { const i = page.locator(`#in-${id}`); await i.click(); await i.fill(text); };
const outv = (page, name) => page.locator(`[data-out="${name}"]`).evaluate(e => e.textContent);
const chapter = (page, c) => page.locator(`[data-chapter="${c}"]`).click();
const act = async (page, a) => { await page.locator(`#stage [data-action="${a}"]`).click(); await settle(page); };
const balance = page => page.locator('#stage [data-balance]').first().innerText().then(t => parseInt(t.trim(), 10));
const ownerBal = page => page.locator('#stage [data-owner-balance]').first().innerText().then(t => t.trim());
const strip = page => txt(page, '#strip-result');
const selected = (page, sel) => page.locator(sel).evaluateAll(els => els.filter(e => e.getAttribute('aria-selected') === 'true').map(e => e.dataset.chapter ?? e.dataset.ownerView));
const pickIndustry = async (page, key) => { const pills = page.locator(`[data-industry-choice="${key}"]`); if (await pills.isVisible()) await pills.click(); else await page.locator('#industry-select').selectOption(key); await settle(page); };

// ---------- every viewport: load, overflow, console, scenes, tab semantics ----------------------------------------------------------
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [720, 450], [390, 844], [360, 740], [320, 640]]) {
  const { page, context, log } = await newPage({ width: w, height: h });
  const tag = `${w}px`;
  check(`${tag}: h1 and title`, (await page.locator('h1').count()) === 1 && (await page.title()).startsWith('Loynara'));
  check(`${tag}: exactly seven main scenes`, (await page.locator('section.hero, section.section').count()) === 7);
  check(`${tag}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  const wide = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1 && !e.closest('details, #chart, table, .data-table, .sr-only, .visually-hidden, [hidden], svg'); }).slice(0, 5).map(e => `${e.tagName}.${e.className}`));
  check(`${tag}: no element sticks out of the viewport`, wide.length === 0, wide.join(','));
  check(`${tag}: no console problems`, log.problems.length === 0, log.problems.join(' | '));
  check(`${tag}: no external requests`, log.external.length === 0, log.external.join(','));
  check(`${tag}: exactly two tab modules (journey chapters, owner views) with ARIA roles`, (await page.locator('[role="tablist"]').count()) === 2 && (await page.locator('[role="tab"]').count()) === 7 && (await page.locator('[role="tabpanel"]').count()) === 2);
  check(`${tag}: roving tabindex (one tab stop per module)`, (await page.locator('[data-chapter][tabindex="0"]').count()) === 1 && (await page.locator('[data-owner-view][tabindex="0"]').count()) === 1);
  const boxes = await page.evaluate(() => ['.hero-phone', '.hero-cashier', '.hero-owner', '.hero-stand'].map(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  const overlap = (a, b) => a && b && a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
  check(`${tag}: hero surfaces do not collide; small stand present (hidden only on phones <= 380 px)`, boxes.every(Boolean) && (w <= 380 || boxes[3][2] - boxes[3][0] > 30) && !overlap(boxes[0], boxes[1]) && !overlap(boxes[0], boxes[2]) && !overlap(boxes[1], boxes[2]) && !overlap(boxes[3], boxes[0]) && !overlap(boxes[3], boxes[1]) && !overlap(boxes[3], boxes[2]), JSON.stringify(boxes));
  const hero = await txt(page, '.hero');
  check(`${tag}: hero keeps headline, supporting sentence, flow line and paper-to-digital strip`, /Ein guter Besuch\. Ein Grund, wiederzukommen\./.test(hero) && /Kunden öffnen ihre Karte\. Dein Team bestätigt\. Du siehst, was passiert\./.test(hero) && /Nicht nur Stempel sammeln\. Den nächsten Besuch mitdenken\./.test(hero));
  const sizes = await page.evaluate(() => { const nav = document.querySelector('#main-nav a:not(.button)'), login = document.querySelector('.nav-actions .quiet'); return [getComputedStyle(nav).fontSize, getComputedStyle(login).fontSize]; });
  check(`${tag}: Anmelden matches navigation text size`, w <= 1100 || sizes[0] === sizes[1], sizes.join('/'));
  await context.close();
}

// ---------- desktop + mobile functional runs ------------------------------------------------------------------------------------
for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
  const { page, context, log } = await newPage(viewport, { scale: mobile ? 2 : 1 });
  const H = viewport.height;
  await page.screenshot({ path: `${out}/${label}-hero.png` });

  // ---- menu, anchors, CTAs ----
  for (const [name, id] of [['Ablauf', 'ablauf'], ['Inhaber', 'inhaber'], ['Gestaltung', 'gestaltung'], ['Rechner', 'rechner'], ['Preis', 'angebot']]) {
    if (mobile) { await page.getByRole('button', { name: /Menü/ }).click(); check(`${label}: menu announces expanded`, (await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'true'); }
    await page.locator('#main-nav').getByRole('link', { name, exact: true }).click();
    check(`${label}: nav "${name}" reaches #${id}`, await inView(page, `#${id}`, H));
    if (mobile) check(`${label}: menu closes after navigation`, (await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'false');
  }
  if (mobile) {
    await page.getByRole('button', { name: /Menü/ }).click(); await page.screenshot({ path: `${out}/mobile-menu.png` });
    await page.keyboard.press('Escape');
    check('mobile: Escape closes menu and restores focus', (await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'false' && await page.evaluate(() => document.activeElement?.id === 'menu-toggle'));
  }
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  check(`${label}: hero CTAs`, (await page.locator('.hero .primary').getAttribute('href')) === '#anfrage' && (await page.locator('.hero .secondary').getAttribute('href')) === '#ablauf');
  check(`${label}: login link`, (await page.locator('#main-nav a[href*="app.getloynara.com/login"]').getAttribute('href')) === 'https://app.getloynara.com/login');

  // ---- journey: visible default overview, returning card 8 -> 9 -> 10 -> redeem, tabs never execute events ----
  await jump(page, '#ablauf'); await page.waitForTimeout(400);
  check(`${label}: journey opens on a visible overview: chapter 1 selected, growth strip and stage visible without any click`, (await selected(page, '[data-chapter]')).join() === 'start' && (await page.locator('#growth').isVisible()) && (await page.locator('#stage').isVisible()));
  check(`${label}: default stage shows the returning card at 8/10 and no events happened`, /^Stand 8\/10/.test(await strip(page)) && /Besuche 0/.test(await strip(page)) && /Prämien 0/.test(await strip(page)));
  for (const c of ['collect', 'reward', 'refer', 'start']) { await chapter(page, c); await settle(page); }
  check(`${label}: chapter tabs alone never create a stamp, a redemption or a bonus`, (await selected(page, '[data-chapter]')).join() === 'start' && /Stand 8\/10 · Besuche 0 · Prämien 0/.test(await strip(page)));
  await act(page, 'open-nfc');
  check(`${label}: opening the card by NFC reports the visit; no stamp yet`, await balance(page) === 8 && /Besuch gemeldet/.test(await txt(page, '#stage')));
  await chapter(page, 'collect'); await settle(page);
  await act(page, 'confirm');
  check(`${label}: staff confirmation adds exactly one stamp (9/10) and the owner counter follows`, await balance(page) === 9 && /Besuche 1/.test(await strip(page)) && (await ownerBal(page)).startsWith('9'));
  check(`${label}: no duplicate confirm possible after the stamp`, (await page.locator('#stage [data-action="confirm"]').count()) === 0 || (await page.locator('#stage [data-action="confirm"]').isDisabled()));
  await chapter(page, 'reward'); await settle(page);
  for (let i = 0; i < 3; i++) { const open = page.locator('#stage [data-action="open-nfc"]'); if (await open.count()) { await open.click(); await settle(page); } const conf = page.locator('#stage [data-action="confirm"]'); if (await conf.count()) { await conf.click(); await settle(page); } if (await balance(page) >= 10) break; }
  check(`${label}: card reaches 10/10 and offers redemption`, await balance(page) === 10 && (await page.locator('#stage [data-action="redeem"]').count()) === 1);
  await page.screenshot({ path: `${out}/${label}-journey-reward-ready.png` });
  await act(page, 'redeem');
  check(`${label}: redemption is recorded once and cannot be repeated`, /Prämien 1/.test(await strip(page)) && (await page.locator('#stage [data-action="redeem"]').count()) === 0);
  await chapter(page, 'collect'); await settle(page); await chapter(page, 'reward'); await settle(page);
  check(`${label}: switching chapters after a redemption shows a coherent example snapshot, never a replayed or double-counted redemption`, /Prämien 0/.test(await strip(page)) && (await page.locator('#stage [data-action="redeem"]').count()) === 0 && (await balance(page)) === 9);
  await chapter(page, 'start'); await settle(page); await page.locator('#demo-reset').click(); await settle(page);
  check(`${label}: reset returns the card example to 8/10 with no events`, /Stand 8\/10 · Besuche 0 · Prämien 0/.test(await strip(page)));

  // ---- new card: 0 -> 1 ----
  await chapter(page, 'start'); await settle(page);
  await page.locator('#stage [data-action="identity-new"]').click(); await settle(page);
  check(`${label}: new card starts at 0/10 with no invented history`, /Stand 0\/10/.test(await strip(page)) && /Besuche 0/.test(await strip(page)) && ((await page.locator('#stage [data-balance]').count()) === 0 || (await balance(page)) === 0));
  await act(page, 'open-qr');
  if (await page.locator('#stage [data-action="enroll"]').count()) { await page.locator('#stage [data-action="enroll"]').click(); await settle(page); }
  await chapter(page, 'collect'); await settle(page);
  if (await page.locator('#stage [data-action="confirm"]').count()) await act(page, 'confirm');
  check(`${label}: new card gets its first confirmed stamp: 0 -> 1`, await balance(page) === 1 && /Besuche 1/.test(await strip(page)));
  await page.screenshot({ path: `${out}/${label}-journey-new-first-stamp.png` });
  await page.locator('#demo-reset').click(); await settle(page);
  await chapter(page, 'start'); await settle(page);
  if (await page.locator('#stage [data-action="identity-returning"]').count()) { await page.locator('#stage [data-action="identity-returning"]').click(); await settle(page); }

  // ---- referral: no bonus on share/open, exactly one bonus after confirmation, no duplicates ----
  await chapter(page, 'refer'); await settle(page);
  check(`${label}: referral chapter states the qualification rule and the four states`, /erster Besuch/i.test(await txt(page, '#stage-strip')) && /Link geteilt/.test(await txt(page, '.ref-steps')) && /Teilnahme offen/.test(await txt(page, '.ref-steps')) && /Bedingung erfüllt/.test(await txt(page, '.ref-steps')) && /Bonus verbucht/.test(await txt(page, '.ref-steps')));
  const counts = async () => page.evaluate(() => ['[data-ref-visits]', '[data-ref-qualified]', '[data-ref-bonus]'].map(s => document.querySelector(s)?.textContent.trim()).join('/'));
  const before = await counts(); await page.screenshot({ path: `${out}/${label}-referral-before.png` });
  await act(page, 'ref-share'); check(`${label}: sharing earns nothing`, (await counts()) === before && /Empfehlungen 0/.test(await strip(page)));
  await act(page, 'ref-open'); check(`${label}: opening the link earns nothing`, (await counts()) === before && /Empfehlungen 0/.test(await strip(page)));
  await act(page, 'ref-join'); check(`${label}: joining alone earns nothing (needs a confirmed first visit)`, (await counts()) === before && /Empfehlungen 0/.test(await strip(page)));
  await act(page, 'ref-confirm');
  check(`${label}: confirmed first visit books exactly one bonus; both cards update`, (await counts()) === '1/1/1' && /Empfehlungen 1/.test(await strip(page)) && /8\/10/.test(await strip(page)));
  check(`${label}: no further referral action remains (no duplicate bonus)`, (await page.locator('#stage [data-action^="ref-"]').count()) === 0);
  await page.screenshot({ path: `${out}/${label}-referral-after.png` });
  await chapter(page, 'start'); await settle(page); await chapter(page, 'refer'); await settle(page);
  check(`${label}: leaving and re-entering the referral chapter keeps the booked state, still one bonus`, (await counts()) === '1/1/1');
  await page.locator('#demo-reset').click(); await settle(page);
  check(`${label}: referral reset returns to the beginning`, (await counts()) === '0/0/0' && (await page.locator('#stage [data-action="ref-share"]').count()) === 1);
  check(`${label}: growth strip shows the loop`, /Besuch\s*(→\s*)?Fortschritt\s*(→\s*)?Prämie\s*(→\s*)?Empfehlung\s*(→\s*)?neuer Besuch/.test(await txt(page, '#growth')));

  // ---- mobile: one active surface; inactive panels collapse to a summary ----
  if (mobile) {
    await chapter(page, 'start'); await settle(page);
    await jump(page, '#stage'); await page.waitForTimeout(300);
    const heights = await page.evaluate(() => [...document.querySelectorAll('#stage .stage-panels .panel')].map(p => ({ active: p.classList.contains('is-active'), h: Math.round(p.getBoundingClientRect().height) })));
    check('mobile: exactly one expanded panel in the stage; inactive ones are compact summaries', heights.filter(x => x.active).length === 1 && heights.filter(x => !x.active).every(x => x.h < 90), JSON.stringify(heights));
    await page.screenshot({ path: `${out}/mobile-journey-overview.png` });
  }

  // ---- industry: all eight, calculator untouched, loyalty restarts with a note ----
  await jump(page, '#rechner'); await fill(page, 'gain', '20'); await settle(page);
  await jump(page, '#ablauf'); await page.waitForTimeout(300);
  for (const key of industries) {
    await pickIndustry(page, key);
    const t = await txt(page, '#stage');
    check(`${label}: industry ${key}: stage renders without placeholders`, t.length > 80 && !/undefined|NaN|\[object/.test(t));
  }
  await pickIndustry(page, 'barber');
  check(`${label}: industry change explains the restart and leaves the calculator inputs alone`, /Dein Rechenbeispiel bleibt unverändert/.test(await txt(page, '#industry-note')) && (await page.locator('#in-gain').inputValue()) === '20');
  await pickIndustry(page, 'cafe');
  await page.locator('#calc-reset').evaluate(b => b.click());

  // ---- owner workspace: three views, outlook labelling, keyboard, preview toggles ----
  await jump(page, '#inhaber'); await page.waitForTimeout(400);
  check(`${label}: owner opens on the Überblick with counters and a visible outlook qualification`, (await selected(page, '[data-owner-view]')).join() === 'overview' && /Plattform-Ausblick – nicht im aktuellen Pilotangebot/.test(await txt(page, '#inhaber')) && /Beispieldaten/.test(await txt(page, '#owner-body')));
  await page.screenshot({ path: `${out}/${label}-owner-overview.png` });
  for (const view of ['quiet', 'win']) {
    await page.locator(`[data-owner-view="${view}"]`).click(); await settle(page);
    check(`${label}: owner view ${view} is labelled as Plattform-Ausblick and sends nothing`, /Plattform-Ausblick – nicht im aktuellen Pilotangebot/.test(await txt(page, '#owner-body')) && !/wurde gesendet/.test(await txt(page, '#owner-body')));
    const btn = page.locator('#owner-action');
    if (await btn.isVisible()) { await btn.click(); await settle(page); check(`${label}: owner view ${view} previews a message labelled as preview (not sent)`, /Vorschau/.test(await txt(page, '#owner-body'))); await page.screenshot({ path: `${out}/${label}-owner-${view}-preview.png` }); await btn.click(); await settle(page); }
    await page.screenshot({ path: `${out}/${label}-owner-${view}.png` });
  }
  await page.locator('[data-owner-view="overview"]').click(); await settle(page);
  check(`${label}: owner overview counters are unchanged by selecting views`, /12/.test(await txt(page, '#owner-body')) && /3/.test(await txt(page, '#owner-body')));
  for (const key of industries) { await pickIndustry(page, key); for (const view of ['overview', 'quiet', 'win']) { await page.locator(`[data-owner-view="${view}"]`).click(); await page.waitForTimeout(80); const t = await txt(page, '#owner-body'); check(`${label}: owner ${view} renders for ${key}`, t.length > 40 && !/undefined|NaN|\[object/.test(t)); } }
  await pickIndustry(page, 'cafe'); await page.locator('[data-owner-view="overview"]').click();

  // ---- keyboard on both tab modules ----
  await page.locator('[data-owner-view="overview"]').focus();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  check(`${label}: owner tabs: ArrowRight selects the next view and focus stays on the tab`, (await selected(page, '[data-owner-view]')).join() === 'quiet' && await page.evaluate(() => document.activeElement?.dataset.ownerView === 'quiet'));
  await page.keyboard.press('End'); check(`${label}: owner tabs: End selects the last view`, (await selected(page, '[data-owner-view]')).join() === 'win');
  await page.keyboard.press('Home'); check(`${label}: owner tabs: Home selects the first view`, (await selected(page, '[data-owner-view]')).join() === 'overview');
  await jump(page, '#ablauf'); await page.locator('[data-chapter="start"]').focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
  check(`${label}: chapter tabs: arrows select Belohnen and focus stays on the tab`, (await selected(page, '[data-chapter]')).join() === 'reward' && await page.evaluate(() => document.activeElement?.dataset.chapter === 'reward'));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  check(`${label}: chapter tabs: Empfehlen is reachable by keyboard`, (await selected(page, '[data-chapter]')).join() === 'refer');
  await page.keyboard.press('ArrowRight'); check(`${label}: chapter tabs wrap around`, (await selected(page, '[data-chapter]')).join() === 'start');
  check(`${label}: tabpanel is controlled by the selected tab`, await page.evaluate(() => { const p = document.querySelector('#journey-panel'), t = document.querySelector('[data-chapter][aria-selected="true"]'); return p.getAttribute('role') === 'tabpanel' && t.getAttribute('aria-controls') === p.id; }));
  await page.locator('#demo-reset').click(); await settle(page);

  // ---- branding studio ----
  await jump(page, '#gestaltung'); await page.waitForTimeout(400);
  check(`${label}: studio shows stand, browser card and Wallet-Vorschau with the Gestaltungsbeispiel label`, (await page.locator('#studio-comp .studio-stand').count()) === 1 && (await page.locator('#studio-comp .browser-phone').count()) === 1 && (await page.locator('#studio-comp .wallet-pass').count()) >= 1 && /Gestaltungsbeispiel/.test(await txt(page, '#gestaltung')) && /Wallet-Vorschau/.test(await txt(page, '#gestaltung')));
  check(`${label}: no fake "Add to Wallet" control and no invented stand specification`, (await page.getByRole('button', { name: /wallet|hinzufügen/i }).count()) === 0 && !/Add to Wallet|Zu Wallet hinzufügen|\d+\s?(cm|mm)\b/i.test(await txt(page, '#gestaltung')));
  const brandVars = () => page.evaluate(() => ['#studio-comp .studio-stand', '#studio-comp .browser-phone', '#studio-comp .wallet-pass', '#stage', '.system-mini', '#owner-frame'].map(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).getPropertyValue('--b-dark').trim() : 'none'; }));
  for (const sw of ['wald', 'terrakotta', 'nachtblau', 'pflaume', 'graphit']) {
    await page.locator(`#studio [data-brand-style="${sw}"]`).click(); await page.waitForTimeout(250);
    const vars = await brandVars(), first = vars[0];
    check(`${label}: brand ${sw}: stand, browser card, Wallet preview and journey card share one colour`, first && first !== 'none' && vars.every(v => v === first), vars.join('/'));
    check(`${label}: brand ${sw}: pressed state`, (await page.locator(`#studio [data-brand-style="${sw}"]`).getAttribute('aria-pressed')) === 'true');
    await jump(page, '#studio-comp'); await page.waitForTimeout(150);
    await page.locator('#studio-comp').screenshot({ path: `${out}/${label}-brand-${sw}.png` });
  }
  for (const logo of ['blatt', 'welle', 'monogramm']) { await page.locator(`#studio [data-brand-logo="${logo}"]`).click(); await page.waitForTimeout(150); check(`${label}: logo ${logo} shown on the stand`, (await page.locator('#studio-comp .studio-stand svg').count()) >= 1 && (await page.locator(`#studio [data-brand-logo="${logo}"]`).getAttribute('aria-pressed')) === 'true'); }
  for (const rw of ['aufmerksamkeit', 'extra', 'branche']) { await page.locator(`#studio [data-brand-reward="${rw}"]`).click(); await page.waitForTimeout(150); const t = await txt(page, '#studio-comp'); check(`${label}: reward ${rw} flows into the cards`, !/undefined|NaN/.test(t) && t.length > 60); }
  // independence
  await jump(page, '#rechner'); await fill(page, 'gain', '15'); await settle(page);
  await jump(page, '#ablauf'); await chapter(page, 'start'); await settle(page); await page.locator('#stage [data-action="open-nfc"]').click(); await settle(page); await chapter(page, 'collect'); await settle(page); await act(page, 'confirm');
  const loyaltyBefore = await strip(page);
  await jump(page, '#gestaltung'); await page.locator('#studio [data-brand-style="pflaume"]').click(); await page.waitForTimeout(250);
  await jump(page, '#ablauf');
  check(`${label}: brand change keeps the loyalty state`, (await strip(page)) === loyaltyBefore);
  await jump(page, '#rechner');
  check(`${label}: brand change keeps the calculator inputs and results`, (await page.locator('#in-gain').inputValue()) === '15' && (await outv(page, 'additional')) === '1.365 €');
  const vv = await brandVars(); check(`${label}: the journey card follows the studio brand`, vv.every(v => v === vv[0]) && vv[3] !== 'none');
  await pickIndustry(page, 'friseur'); await jump(page, '#gestaltung');
  check(`${label}: industry change keeps the chosen brand style`, (await page.locator('#studio [data-brand-style="pflaume"]').getAttribute('aria-pressed')) === 'true');
  await pickIndustry(page, 'cafe');
  await page.locator('#studio [data-brand-style="wald"]').click(); await page.locator('#calc-reset').evaluate(b => b.click());

  // ---- calculator ----
  await jump(page, '#rechner'); await page.waitForTimeout(400);
  await page.locator('.calc-assumptions summary').click();
  check(`${label}: calculator default (910 €, 9.100 €, 39 €, +871 €, 10.452 €; ratio 23,3×)`, (await outv(page, 'additional')) === '910 €' && (await outv(page, 'baseline')) === '9.100 €' && (await outv(page, 'fee')) === '39 €' && (await outv(page, 'difference')) === '+871 €' && (await outv(page, 'annualised')) === '10.452 €' && (await outv(page, 'ratio')) === '23,3×');
  check(`${label}: ratio sits inside the details, outside the primary result`, await page.evaluate(() => !!document.querySelector('.calc-assumptions [data-out="ratio"]') && !document.querySelector('.primary-figure [data-out="ratio"], .after-fee [data-out="ratio"]')));
  check(`${label}: ratio is labelled as a revenue-to-fee comparison, not profit or ROI`, /Zusatzumsatz im Vergleich zur Monatsgebühr/.test(await page.locator('.calc-assumptions').innerText()) && /kein Gewinn und keine garantierte Rendite/.test(await page.locator('.calc-assumptions').innerText()));
  const order = await page.evaluate(() => { const y = s => document.querySelector(s).getBoundingClientRect().top; return [y('.disclaimer'), y('.calc-assumptions summary')]; });
  check(`${label}: "Annahmen im Detail" sits below the disclaimer`, order[1] > order[0]);
  await page.locator('.calc-assumptions summary').click();
  check(`${label}: month-12 gap label on the chart reads "+10.920 € Zusatzumsatz" (before fee)`, /\+10\.920 € Zusatzumsatz/.test(await page.locator('#chart .gaplabel').innerHTML()));
  await page.screenshot({ path: `${out}/${label}-calc-default.png` });
  await fill(page, 'basket', '7,50'); await settle(page);
  check(`${label}: comma decimals (50 × 7,50 × 26 × 10 % = 975 €)`, (await outv(page, 'additional')) === '975 €' && (await outv(page, 'difference')) === '+936 €');
  await fill(page, 'gain', '0'); await settle(page);
  check(`${label}: zero increase shows −39 €, −468 € and no month-12 label`, (await outv(page, 'additional')) === '0 €' && (await outv(page, 'difference')) === '−39 €' && (await outv(page, 'annualised')) === '−468 €' && (await outv(page, 'ratio')) === '0×' && (await page.locator('#chart .gaplabel').count()) === 0);
  await page.screenshot({ path: `${out}/${label}-calc-zero.png` });
  await fill(page, 'visits', '1000'); await fill(page, 'basket', '500'); await fill(page, 'days', '31'); await fill(page, 'gain', '100'); await settle(page);
  check(`${label}: maximum values stay finite`, !/NaN|Infinity|undefined/.test(await page.locator('.calc-grid').innerText()) && (await outv(page, 'additional')) === '15.500.000 €' && !/NaN|Infinity/.test(await page.locator('#chart-plot').innerHTML()));
  await fill(page, 'basket', '-3'); await page.locator('#in-basket').blur(); await page.waitForTimeout(300);
  check(`${label}: negative value is rejected and old results are not shown as current`, /Negative Werte/.test(await page.locator('#err-basket').innerText()) && (await outv(page, 'additional')) === '–' && !(await page.locator('#calc-empty').isHidden()));
  await page.screenshot({ path: `${out}/${label}-calc-invalid.png` });
  for (const bad of ['1e5', 'abc', '1.234,5', '7,555']) { await fill(page, 'basket', bad); await page.locator('#in-basket').blur(); check(`${label}: "${bad}" is rejected`, (await page.locator('#in-basket').getAttribute('aria-invalid')) === 'true' && (await page.locator('#err-basket').innerText()).length > 5); }
  await fill(page, 'basket', ''); await page.locator('#in-basket').blur();
  check(`${label}: blank field is explained`, /Wert eingeben/.test(await page.locator('#err-basket').innerText()));
  await page.locator('#calc-reset').click(); await settle(page);
  check(`${label}: reset restores the example`, (await outv(page, 'additional')) === '910 €' && (await page.locator('#calc-empty').isHidden()) && (await page.locator('#in-basket').inputValue()) === '7');
  await page.locator('#rg-gain').focus(); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
  check(`${label}: slider keyboard (gain 10 → 13, text and results follow)`, (await page.locator('#in-gain').inputValue()) === '13' && (await outv(page, 'additional')) === '1.183 €');
  await page.locator('#calc-reset').click(); await page.waitForTimeout(400);
  const svg = page.locator('#chart'); await svg.focus(); await page.keyboard.press('End');
  const ro = async () => (await page.locator('#chart-readout').innerText()).replace(/\s+/g, ' ');
  check(`${label}: keyboard inspection shows month 12 with exact values in the readout`, /Monat 12/.test(await ro()) && /109\.200 €/.test(await ro()) && /120\.120 €/.test(await ro()) && /10\.920 €/.test(await ro()));
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); check(`${label}: arrow keys move the month`, /Monat 10/.test(await ro()));
  const sb = await page.locator('#chart-readout').boundingBox(), wrapBox = await page.locator('#chart-wrap').boundingBox();
  check(`${label}: the readout never overlaps the plotting area`, sb.y + sb.height <= wrapBox.y + 1);
  await page.locator('#chart').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, 120)); await page.waitForTimeout(200);
  const box = await page.locator('#chart-hit').boundingBox();
  if (mobile) await page.touchscreen.tap(box.x + box.width * 0.45, box.y + box.height * 0.5); else await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.waitForTimeout(150);
  check(`${label}: pointer/touch inspection updates the same readout`, /Monat (5|6|7)\b/.test(await ro()));
  check(`${label}: no tooltip element covers the chart`, (await page.locator('.tooltip, #chart-tip').count()) === 0);
  await page.screenshot({ path: `${out}/${label}-chart-readout.png` });
  await page.locator('.data-table summary').click();
  check(`${label}: data table has 13 month rows (accessible alternative to the graph)`, (await page.locator('#chart-table tbody tr').count()) === 13);
  await page.locator('.data-table summary').click();

  // ---- offer, FAQ, request ----
  await jump(page, '#angebot'); await page.waitForTimeout(300);
  const offer = await txt(page, '#angebot');
  check(`${label}: offer: 39 € / Monat / Standort with pilot qualifier; current offer and outlook are separated`, /39 € \/ Monat \/ Standort/.test(offer) && /Pilotangebot – Details im persönlichen Gespräch/i.test(offer) && /Aktuelles Pilotangebot/i.test(offer) && /Gezeigter Ausblick · gesondert zu vereinbaren/i.test(offer));
  check(`${label}: offer: no setup fee, trial, discount, contract, VAT or hardware inclusion claims`, !/Einrichtungsgebühr|kostenlos|Testphase|Rabatt|Vertragslaufzeit|zzgl\.|inkl\.|MwSt|Hardware inklusive|Aufsteller inklusive/i.test(offer));
  const faqN = await page.locator('#angebot details').count();
  check(`${label}: FAQ has 5–6 disclosures, including referrals`, faqN >= 5 && faqN <= 6 && /Wann wird eine Empfehlung belohnt/.test(offer), String(faqN));
  const d = page.locator('#angebot details').first(); await d.locator('summary').click();
  check(`${label}: FAQ opens`, await d.evaluate(e => e.open));
  await page.screenshot({ path: `${out}/${label}-offer.png` });
  await jump(page, '#rechner'); await page.locator('#calc-share').evaluate(b => b.click());
  check(`${label}: sharing the numbers is explicit and shown in the form`, !(await page.locator('#request-figures').isHidden()));
  await page.locator('#request-figures-remove').click(); check(`${label}: shared numbers can be removed`, await page.locator('#request-figures').isHidden());
  await jump(page, '#anfrage');
  await page.getByRole('button', { name: /E-Mail vorbereiten/ }).click();
  check(`${label}: empty request is refused and focused`, /Namen deines Geschäfts/.test(await page.locator('#request-status').innerText()) && await page.evaluate(() => document.activeElement?.id === 'req-business'));
  await page.locator('#req-business').fill('Bäckerei & Café "Süß"'); await page.locator('#req-message').fill('Zeile 1\nZeile 2');
  await page.locator('#calc-share').evaluate(b => b.click());
  await page.getByRole('button', { name: /E-Mail vorbereiten/ }).click(); await page.waitForTimeout(200);
  const mail = decodeURIComponent(log.mails.at(-1) ?? '');
  check(`${label}: mail draft goes to support with umlauts, line breaks and the shared figures`, mail.startsWith('mailto:support@getloynara.com?subject=Demo-Anfrage Loynara – Bäckerei & Café "Süß"') && mail.includes('Zeile 1\nZeile 2') && mail.includes('Käufe pro Tag: 50') && mail.includes('kein Gewinn'));
  check(`${label}: page says nothing was sent`, /Gesendet ist noch nichts/.test(await page.locator('#request-status').innerText()) && !(await page.locator('#request-copy').isHidden()));
  await page.locator('#request-copy').click(); await page.waitForTimeout(200);
  check(`${label}: denied clipboard is handled with a fallback message`, /Kopieren war nicht möglich|Text kopiert/.test(await page.locator('#request-status').innerText()));
  check(`${label}: closing scene repeats the headline and the direct contact address`, /Gib dem nächsten Besuch einen Grund\. Und der nächsten Empfehlung einen Weg\./.test(await txt(page, '#anfrage')) && (await page.locator('#anfrage a[href^="mailto:support@getloynara.com"]').count()) >= 1);
  const sep = await page.evaluate(() => { const l = document.querySelector('.after').getBoundingClientRect(), e = document.querySelector('.existing').getBoundingClientRect(); return e.top - l.bottom; });
  check(`${label}: "Schon dabei?" is separated from the request steps`, sep >= 24, String(sep));
  await page.screenshot({ path: `${out}/${label}-request.png` });
  for (const [name, href] of [['Impressum', '/impressum/'], ['Datenschutz', '/datenschutz/']]) check(`${label}: footer ${name}`, (await page.locator('footer').getByRole('link', { name }).getAttribute('href')) === href);
  check(`${label}: no console problems during the whole run`, log.problems.length === 0, log.problems.join(' | '));
  check(`${label}: no external requests during the whole run`, log.external.length === 0, log.external.join(','));
  await context.close();
}

// ---------- 320 px ------------------------------------------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 320, height: 640 }, { scale: 2 });
  await jump(page, '#calc-form'); await page.waitForTimeout(300);
  const fits = await page.evaluate(() => { const card = document.querySelector('.calc-inputs').getBoundingClientRect(); return [...document.querySelectorAll('.field-input')].every(e => { const r = e.getBoundingClientRect(); return r.right <= card.right - 4 && r.left >= card.left; }); });
  check('320px: every calculator input (incl. basket with € unit) stays inside its card', fits);
  await fill(page, 'basket', '12,75'); await page.waitForTimeout(300);
  check('320px: typed value and result update; caret keeps working', (await page.locator('#in-basket').inputValue()) === '12,75' && (await outv(page, 'additional')) === '1.658 €');
  await page.screenshot({ path: `${out}/w320-calc.png` });
  await jump(page, '#ablauf'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w320-journey.png` });
  const tabsFit = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].every(t => { const r = t.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.height >= 40 && r.width >= 40; }));
  check('320px: every tab is inside the viewport and at least 40 px in both directions', tabsFit);
  await jump(page, '#gestaltung'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w320-studio.png` });
  const studioFit = await page.evaluate(() => [...document.querySelectorAll('#studio *')].every(e => e.closest('svg') || e.getBoundingClientRect().width === 0 || e.getBoundingClientRect().right <= innerWidth + 1));
  check('320px: studio controls and previews stay inside the viewport', studioFit);
  await jump(page, '#angebot'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w320-offer.png` });
  await context.close(); }

// ---------- legal pages -------------------------------------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1280, height: 800 });
  for (const path of ['/impressum/', '/datenschutz/']) { const r = await page.goto(base + path); check(`${path} loads with content`, r.status() === 200 && (await page.locator('main').innerText()).length > 200 && (await page.locator('h1').count()) === 1); }
  await context.close(); }

// ---------- reveal robustness: anchors, reload, Back, resize, print --------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1440, height: 900 });
  const hidden = () => page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].filter(e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).opacity !== '1'; }).length);
  for (const id of ['inhaber', 'gestaltung', 'rechner', 'angebot']) { await page.evaluate(i => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById(i).offsetTop + 120); }, id); await page.waitForTimeout(900); check(`reveals: #${id} becomes fully visible after an instant jump`, await hidden() === 0); }
  await page.reload(); await page.waitForTimeout(1200); check('reveals: nothing visible stays hidden after a reload with restored scroll', await hidden() === 0);
  await page.goto(base + '/impressum/'); await page.waitForTimeout(300); await page.goBack(); await page.waitForTimeout(1200); check('reveals: nothing visible stays hidden after Back from a legal page', await hidden() === 0);
  await page.setViewportSize({ width: 600, height: 900 }); await page.waitForTimeout(700); check('reveals: nothing visible stays hidden after resize', await hidden() === 0);
  await context.close(); }
{ const { page, context } = await newPage({ width: 1280, height: 800 });
  await page.emulateMedia({ media: 'print' });
  const state = await page.evaluate(() => ({ revealHidden: [...document.querySelectorAll('[data-reveal]')].filter(e => getComputedStyle(e).opacity !== '1').length, headerPos: getComputedStyle(document.querySelector('.header')).position, panelsHidden: [...document.querySelectorAll('[role=tabpanel]')].filter(e => getComputedStyle(e).display === 'none').length }));
  check('print: all reveal content is visible before any scrolling; header is not sticky; no tabpanel is hidden', state.revealHidden === 0 && state.headerPos === 'static' && state.panelsHidden === 0, JSON.stringify(state));
  await page.screenshot({ path: `${out}/print-top.png`, fullPage: true });
  const pdf = await page.pdf({ format: 'A4', printBackground: true }); check('print: a PDF can be produced', pdf.length > 20000);
  await context.close(); }

// ---------- orientation change and increased text size ---------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 390, height: 844 }, { scale: 2 });
  await jump(page, '#ablauf'); await page.locator('#stage [data-action="open-nfc"]').click(); await settle(page);
  const before = await strip(page);
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(600);
  check('orientation: landscape keeps state, no overflow', (await strip(page)) === before && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  check('orientation: back to portrait keeps state, no overflow', (await strip(page)) === before && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; }); await page.waitForTimeout(400);
  check('increased text size (125 %): no horizontal overflow on the phone', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await jump(page, '#ablauf'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/mobile-text125-journey.png` });
  await jump(page, '#rechner'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/mobile-text125-calc.png` });
  await context.close(); }

// ---------- reduced motion + no JS --------------------------------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1280, height: 800 }, { reduced: true });
  check('reduced motion: sections are visible without reveal animation', await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].every(e => getComputedStyle(e).opacity === '1')));
  await jump(page, '#rechner'); await fill(page, 'gain', '20');
  check('reduced motion: calculator values change immediately', (await outv(page, 'additional')) === '1.820 €');
  await jump(page, '#ablauf'); await page.locator('[data-action="open-nfc"]').click(); await chapter(page, 'collect'); await page.locator('[data-action="confirm"]').click();
  check('reduced motion: journey works with instant state changes', (await ownerBal(page)).startsWith('9'));
  check('reduced motion: smooth scrolling is disabled', await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto'));
  await context.close(); }
{ const { page, context } = await newPage({ width: 1280, height: 800 }, { js: false });
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('no JS: proposition, price, calculator example and contact link are present', /Ein guter Besuch/.test(text) && /39 € \/ Monat \/ Standort/.test(text) && /910 € zusätzlicher Monatsumsatz/.test(text) && (await page.locator('a[href^="mailto:support@getloynara.com"]').count()) >= 1);
  check('no JS: journey explains the chapters in text; outlook labels remain readable; nothing is hidden', /JavaScript aktivieren/.test(text) && /Starten/.test(text) && /Empfehlen/.test(text) && /Plattform-Ausblick/.test(text) && await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].every(e => getComputedStyle(e).opacity === '1')));
  await page.screenshot({ path: `${out}/nojs-top.png`, fullPage: true });
  await context.close(); }

// ---------- screenshots at intermediate widths -----------------------------------------------------------------------------------------
for (const [w, h] of [[1280, 800], [1024, 768], [768, 1024]]) { const { page, context } = await newPage({ width: w, height: h }); await page.screenshot({ path: `${out}/w${w}-hero.png` }); await jump(page, '#ablauf'); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/w${w}-journey.png` }); await jump(page, '#gestaltung'); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/w${w}-studio.png` }); await context.close(); }
await browser.close();
console.log(`PASS: ${results.length} browser checks.`);
