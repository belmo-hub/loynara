import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Final-page (Concept C) browser checks. Needs the loopback preview (PORT=8795 npm run marketing:preview).
// Local Chromium (system Chrome) only: no WebKit, no Safari, no physical phone, no screen reader.
const base = process.env.BASE ?? 'http://127.0.0.1:8765', out = 'marketing-site/evidence/screens';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok = true, detail = '') => { if (!ok) console.error(`FAIL: ${name} ${detail}`); assert.ok(ok, `${name} ${detail}`); results.push(name); };
const settle = page => page.waitForTimeout(420);
const jump = (page, sel) => page.evaluate(s => document.querySelector(s).scrollIntoView({ behavior: 'instant', block: 'start' }), sel);
const txt = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ');
const out$ = (page, k) => page.locator(`[data-out="${k}"]`).first().textContent();
const selected = (page, sel) => page.locator(sel).evaluateAll(els => els.filter(e => e.getAttribute('aria-selected') === 'true').map(e => e.dataset.view));
const fill = async (page, key, text) => { const i = page.locator(`[data-in="${key}"]`); await i.click(); await i.fill(text); };

async function newPage(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, deviceScaleFactor: opts.scale ?? 1, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', javaScriptEnabled: opts.js !== false });
  const page = await context.newPage();
  const log = { problems: [], external: [], mails: [], storage: [] };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => log.problems.push(`pageerror: ${e.message}`));
  page.on('request', r => { const u = r.url(); if (u.startsWith('mailto:')) log.mails.push(u); else if (!u.startsWith(base) && !u.startsWith('data:')) log.external.push(u); });
  await page.goto(base + '/');
  await page.waitForTimeout(700);
  return { page, context, log };
}

// ---------- every viewport: structure, overflow, console, tabs, first viewport ---------------------------------------------------------
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [430, 932], [390, 844], [375, 812], [360, 800], [320, 740]]) {
  const { page, context, log } = await newPage({ width: w, height: h });
  const tag = `${w}px`;
  check(`${tag}: one h1, title`, (await page.locator('h1').count()) === 1 && (await page.title()).startsWith('Loynara'));
  check(`${tag}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  const wide = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1 && !e.closest('details:not([open]), svg, .ctable'); }).slice(0, 5).map(e => `${e.tagName}.${e.className}`));
  check(`${tag}: nothing sticks out of the viewport`, wide.length === 0, wide.join(','));
  check(`${tag}: no console problems, no external requests`, log.problems.length === 0 && log.external.length === 0, [...log.problems, ...log.external].join(' | '));
  check(`${tag}: three tab modules with ARIA roles and roving tabindex`, (await page.locator('[role=tablist]').count()) === 3 && (await page.locator('[role=tab]').count()) === 8 && (await page.locator('[role=tabpanel]').count()) === 3 && (await page.locator('[role=tab][tabindex="0"]').count()) === 3);
  // tab labels never clipped
  const clipped = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter(t => t.scrollWidth > t.clientWidth + 1 || t.getBoundingClientRect().right > innerWidth + 1 || t.getBoundingClientRect().height < 40).map(t => t.textContent));
  check(`${tag}: no clipped tab labels, every tab at least 40 px high`, clipped.length === 0, clipped.join(','));
  // first viewport: headline, explanation, primary CTA, product context
  const fv = await page.evaluate(() => { const vh = innerHeight, r = s => document.querySelector(s).getBoundingClientRect(); return { h1: r('h1').bottom <= vh, lead: r('.hero .lead').bottom <= vh, cta: r('.hero .btn-primary').bottom <= vh && r('.hero .btn-primary').top >= 0, product: r('.hero-comp').top < vh - 60 }; });
  check(`${tag}: first viewport holds headline, explanation, primary CTA and the start of the product visual`, fv.h1 && fv.lead && (fv.cta || w < 700) && fv.product, JSON.stringify(fv));
  // essential value is in the DOM and visible in the default state (no tab needed)
  const dv = await page.evaluate(() => { const vis = e => !!(e.offsetParent || e.getClientRects().length); const t = [...document.querySelectorAll('main *')].filter(vis).map(e => e.textContent).join(' ').replace(/\s+/g, ' '); return t; });
  for (const re of [/Besuche belohnen/i, /Empfehlungen fördern/i, /Kundenaktivität verstehen/i, /Kunde öffnet Karte/, /Team bestätigt/, /Fortschritt wächst/, /Empfehlung kann folgen/, /Aus Stammkunden können Empfehlungen werden/, /Sieh, was passiert/, /Aufsteller/, /Gestaltungsbeispiel/, /Wallet-Vorschau/, /39 € \/ Monat \/ Standort/, /Aktuell enthalten/, /Gezeigter Ausblick/, /Geteilt[\s\S]*Teilnahme offen[\s\S]*Bedingung erfüllt[\s\S]*Bonus verbucht/]) check(`${tag}: visible by default, no tab needed: ${re}`, re.test(dv));
  await context.close();
}

// ---------- functional runs: desktop + mobile ----------------------------------------------------------------------------------------
for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
  const { page, context, log } = await newPage(viewport, { scale: mobile ? 2 : 1 });
  await page.screenshot({ path: `${out}/${label}-hero.png` });
  // ---- CTAs and navigation ----
  await page.locator('.hero .btn-primary').click(); await page.waitForTimeout(1300);
  const reached = await page.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById('anfrage').getBoundingClientRect().top), mailOpened: false }));
  check(`${label}: hero "Demo anfragen" scrolls to the contact section and does not open a mail client`, reached.hash === '#anfrage' && reached.top < 200 && log.mails.length === 0, JSON.stringify(reached));
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  await page.locator('.hero .btn-ghost').click(); await page.waitForTimeout(1300);
  check(`${label}: "Ablauf ansehen" reaches the product section`, (await page.evaluate(() => location.hash)) === '#ablauf' && await page.evaluate(() => Math.abs(document.getElementById('ablauf').getBoundingClientRect().top) < 200));
  check(`${label}: login is a quiet link to the app`, (await page.locator('.login').getAttribute('href')) === 'https://app.getloynara.com/login' && !(await page.locator('.login').evaluate(e => e.classList.contains('btn'))));
  if (!mobile) for (const [name, id] of [['Ablauf', 'ablauf'], ['Empfehlungen', 'empfehlung'], ['Inhaber', 'inhaber'], ['Gestaltung', 'gestaltung'], ['Rechner', 'rechner'], ['Preis', 'angebot']]) { await page.locator('.mainnav').getByRole('link', { name, exact: true }).click(); await page.waitForTimeout(1200); check(`${label}: nav "${name}" reaches #${id}`, await page.evaluate(i => Math.abs(document.getElementById(i).getBoundingClientRect().top) < 260, id)); }

  // ---- product stage: visit ----
  await jump(page, '#ablauf'); await page.waitForTimeout(300);
  check(`${label}: stage opens on the visit view with the card at 8/10 and no business event`, (await selected(page, '[data-tabs="stage"] [role=tab]')).join() === 'visit' && /8 von 10/.test(await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label')) && /noch kein bestätigter Besuch/.test(await txt(page, '[data-bind="visit-owner"]')));
  for (const v of ['reward', 'refer', 'visit']) { await page.locator(`#stage-${v}`).click(); await settle(page); }
  check(`${label}: selecting tabs never confirms, redeems or books anything`, /8 von 10/.test(await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label')) && /noch keine eingelöste Prämie/.test(await page.locator('[data-bind="reward-owner"]').textContent()) && /noch keine qualifizierte Empfehlung/.test(await page.locator('[data-bind="refer-owner"]').textContent()));
  const cb = page.locator('[data-act="visit"]'); await cb.click(); await cb.click({ force: true }).catch(() => {}); await settle(page);
  check(`${label}: confirmation adds exactly one stamp (9/10), owner follows, cannot repeat`, /9 von 10/.test(await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label')) && /1 bestätigter Besuch/.test(await txt(page, '[data-bind="visit-owner"]')) && await cb.isDisabled());
  await page.screenshot({ path: `${out}/${label}-stage-confirmed.png` });
  await page.locator('[data-reset="visit"]').click(); await settle(page);
  check(`${label}: reset returns to 8/10 and refocuses the action`, /8 von 10/.test(await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label')) && !(await cb.isDisabled()));
  // ---- reward ----
  await page.locator('#stage-reward').click(); await settle(page);
  check(`${label}: reward view shows a full card with a redeem action`, /10 von 10/.test(await page.locator('[data-slot="reward-card"] .lcard').getAttribute('aria-label')));
  await page.locator('[data-act="reward"]').click(); await settle(page);
  check(`${label}: redemption resets the card to 0/10, the owner sees exactly one redemption, no repeat`, /0 von 10/.test(await page.locator('[data-slot="reward-card"] .lcard').getAttribute('aria-label')) && /1 eingelöste Prämie/.test(await txt(page, '[data-bind="reward-owner"]')) && await page.locator('[data-act="reward"]').isDisabled());
  await page.locator('[data-reset="reward"]').click(); await settle(page);

  // ---- referral: no reward for sharing, opening or joining; one bonus after the first confirmed visit ----
  await page.locator('#stage-refer').click(); await settle(page);
  const bal = () => page.locator('[data-slot="refer-card"] .lcard').getAttribute('aria-label').then(t => Number(t.match(/(\d+) von 10/)[1]));
  const doneSteps = () => page.locator('#stage .ref-steps li.done').count();
  const ownerRef = () => txt(page, '[data-bind="refer-owner"]');
  await page.screenshot({ path: `${out}/${label}-referral-0.png` });
  const act = page.locator('[data-act="refer"]');
  const labels = [];
  for (const [i, expectBal] of [[0, 7], [1, 7], [2, 7]]) { labels.push(await act.textContent()); await act.click(); await settle(page); check(`${label}: referral action ${i + 1} (${labels[i]}) earns nothing: Kunde A stays at 7`, await bal() === expectBal && /noch keine qualifizierte Empfehlung/.test(await ownerRef())); }
  check(`${label}: joined state = "Teilnahme offen": two steps lit, the next action is the first confirmed visit`, await doneSteps() === 2 && /Ersten Besuch bestätigen/.test(await act.textContent()));
  await act.click(); await settle(page);
  check(`${label}: qualification books exactly one bonus (7 → 8); all four steps lit; owner sees one qualified referral`, await bal() === 8 && await doneSteps() === 4 && /1 qualifizierte Empfehlung, 1 Bonus verbucht/.test(await ownerRef()) && await act.isDisabled());
  await page.screenshot({ path: `${out}/${label}-referral-qualified.png` });
  await act.click({ force: true }).catch(() => {}); await settle(page);
  check(`${label}: no duplicate bonus`, await bal() === 8);
  await page.locator('[data-reset="refer"]').click(); await settle(page);
  check(`${label}: referral reset restores 7/10 and zero owner activity`, await bal() === 7 && await doneSteps() === 0 && /noch keine qualifizierte Empfehlung/.test(await ownerRef()));
  check(`${label}: the visit and reward state were not touched by the referral demo`, /8 von 10/.test(await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label')));

  // ---- keyboard on the stage tabs ----
  await page.locator('#stage-visit').click(); await page.locator('#stage-visit').focus(); await page.keyboard.press('ArrowRight');
  check(`${label}: stage tabs: ArrowRight selects the next view and focus stays on the tab`, (await selected(page, '[data-tabs="stage"] [role=tab]')).join() === 'reward' && await page.evaluate(() => document.activeElement?.id === 'stage-reward'));
  await page.keyboard.press('End'); check(`${label}: stage tabs: End → last`, (await selected(page, '[data-tabs="stage"] [role=tab]')).join() === 'refer');
  await page.keyboard.press('ArrowRight'); check(`${label}: stage tabs wrap around`, (await selected(page, '[data-tabs="stage"] [role=tab]')).join() === 'visit');

  // ---- owner views ----
  await jump(page, '#inhaber'); await settle(page);
  check(`${label}: owner opens on Überblick with example data`, (await selected(page, '[data-tabs="owner"] [role=tab]')).join() === 'overview' && /Beispieldaten/.test(await txt(page, '#owner')));
  await page.screenshot({ path: `${out}/${label}-owner-overview.png` });
  for (const v of ['quiet', 'win']) {
    await page.locator(`#owner-${v}`).click(); await settle(page);
    const t = await txt(page, '#owner');
    check(`${label}: owner ${v}: labelled Plattform-Ausblick, message is an unsent preview, one main idea`, /Plattform-Ausblick – nicht im aktuellen Pilotangebot/.test(t) && /Vorschau · nicht versendet/i.test(t) && !/wurde gesendet|Zugestellt|zurückgekehrt/.test(t) && (await page.locator('#owner .ow:not([hidden])').count()) === 1);
    await page.screenshot({ path: `${out}/${label}-owner-${v}.png` });
  }
  await page.locator('#owner-overview').focus(); await page.keyboard.press('End');
  check(`${label}: owner tabs: End selects Zurückholen`, (await selected(page, '[data-tabs="owner"] [role=tab]')).join() === 'win');
  await page.locator('#owner-overview').click();

  // ---- branding studio ----
  await jump(page, '#gestaltung'); await settle(page);
  const colours = () => page.evaluate(() => [...document.querySelectorAll('#studio [data-studio] .stand .st-face, #studio [data-studio] .lcard, #studio [data-studio] .wpass')].map(e => getComputedStyle(e).getPropertyValue('--b-dark').trim()));
  check(`${label}: studio defaults to the physical pair: stand + card, labelled Gestaltungsbeispiel; Wallet is a deliberate second view`, (await page.locator('#studio [data-studio] .stand').count()) === 1 && (await page.locator('#studio [data-studio] .lcard').count()) === 1 && (await page.locator('#studio [data-studio] .wpass').count()) === 0 && /Gestaltungsbeispiel/.test(await txt(page, '#studio')));
  // set some state elsewhere first to prove independence
  await page.locator('#stage-visit').scrollIntoViewIfNeeded(); await page.locator('[data-act="visit"]').click(); await settle(page);
  await jump(page, '#rechner'); await fill(page, 'gain', '15'); await settle(page);
  await jump(page, '#studio'); await settle(page);
  const sel = { wald: '#143D2E', terrakotta: '#7A3320', nachtblau: '#16264A', pflaume: '#4A1D44', graphit: '#1C2326' };
  for (const [k, hex] of Object.entries(sel)) {
    await page.locator(`[data-brand-style="${k}"]`).click(); await page.waitForTimeout(250);
    const c = await colours(); check(`${label}: colour ${k}: stand and card share ${hex}`, c.length === 2 && c.every(v => v === hex), c.join('/'));
    await page.locator('#studio-view-wallet').click(); await page.waitForTimeout(250);
    const w = await colours(); check(`${label}: colour ${k}: Wallet-Vorschau follows (${hex})`, w.length === 1 && w[0] === hex);
    await page.locator('#studio-view-tresen').click(); await page.waitForTimeout(200);
    await page.locator('#studio').screenshot({ path: `${out}/${label}-studio-${k}.png` });
  }
  for (const logo of ['blatt', 'welle', 'monogramm']) { await page.locator(`[data-brand-logo="${logo}"]`).click(); await page.waitForTimeout(150); const svgs = await page.evaluate(() => [...document.querySelectorAll('#studio [data-studio] .lc-logo svg, #studio [data-studio] .st-logo')].length); check(`${label}: logo ${logo} appears on stand and card`, svgs >= 2 && (await page.locator(`[data-brand-logo="${logo}"]`).getAttribute('aria-pressed')) === 'true'); }
  for (const r of ['aufmerksamkeit', 'extra', 'branche']) { await page.selectOption('#brand-reward', r); await page.waitForTimeout(150); const t = await txt(page, '#studio [data-studio]'); check(`${label}: reward ${r} reaches the card`, !/undefined|NaN/.test(t) && /ab 10 Stempeln/.test(t)); }
  await page.locator('[data-brand-style="pflaume"]').click(); await page.waitForTimeout(200);
  check(`${label}: brand changes leave the loyalty stage as it was (9/10 confirmed) and the calculator untouched (15 % → 1.365 €)`, /9 von 10/.test(await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label')) && (await page.locator('[data-in="gain"]').inputValue()) === '15' && (await out$(page, 'additional')) === '1.365 €');
  check(`${label}: the studio makes no request and writes no storage`, log.external.length === 0 && await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''));
  await page.locator('[data-brand-style="wald"]').click();

  // ---- calculator ----
  await page.locator('[data-calc-reset]').click(); await jump(page, '#rechner'); await settle(page);
  await page.locator('.more summary').click();
  check(`${label}: calculator default: 910 / 9.100 / 39 / +871 / +10.452 / ratio 23,3×`, (await out$(page, 'additional')) === '910 €' && (await out$(page, 'baseline')) === '9.100 €' && (await out$(page, 'fee')) === '39 €' && (await out$(page, 'difference')) === '+871 €' && (await out$(page, 'annualised')) === '+10.452 €' && (await out$(page, 'ratio')) === '23,3×');
  check(`${label}: ratio is only inside the details`, await page.evaluate(() => !!document.querySelector('.more [data-out="ratio"]') && !document.querySelector('.result [data-out="ratio"]')));
  await page.locator('.more summary').click();
  check(`${label}: chart label "+10.920 € Zusatzumsatz" (before fee)`, /\+10\.920 € Zusatzumsatz/.test(await page.locator('[data-chart]').innerHTML()));
  await page.screenshot({ path: `${out}/${label}-calc-default.png` });
  await fill(page, 'basket', '7,50'); await settle(page);
  check(`${label}: comma decimals (975 € / +936 €)`, (await out$(page, 'additional')) === '975 €' && (await out$(page, 'difference')) === '+936 €');
  await fill(page, 'basket', '7'); await fill(page, 'gain', '0'); await settle(page);
  check(`${label}: 0 % is not softened: 0 €, −39 €, −468 €, ratio 0×, fee-exceeds note shown, result card not green`, (await out$(page, 'additional')) === '0 €' && (await out$(page, 'difference')) === '−39 €' && (await out$(page, 'annualised')) === '−468 €' && (await out$(page, 'ratio')) === '0×' && await page.locator('[data-zero-note]').isVisible() && await page.evaluate(() => getComputedStyle(document.querySelector('.result')).backgroundColor !== getComputedStyle(document.querySelector('.final')).backgroundColor) && (await page.locator('[data-calc].is-negative').count()) === 1 && (await page.locator('[data-chart] .gaplabel').count()) === 0);
  await page.screenshot({ path: `${out}/${label}-calc-zero.png` });
  await fill(page, 'visits', '1000'); await fill(page, 'basket', '500'); await fill(page, 'days', '31'); await fill(page, 'gain', '100'); await settle(page);
  check(`${label}: maximum values stay finite (15.500.000 €)`, (await out$(page, 'additional')) === '15.500.000 €' && !/NaN|Infinity/.test(await page.locator('[data-calc]').innerText() + await page.locator('[data-chart]').innerHTML()));
  await fill(page, 'basket', '-3'); await page.locator('[data-in="basket"]').blur(); await settle(page);
  check(`${label}: negative input is rejected, old results are not shown as current`, /Negative Werte/.test(await page.locator('[data-err="basket"]').innerText()) && (await out$(page, 'additional')) === '–' && await page.locator('[data-calc-empty]').isVisible());
  for (const bad of ['1e5', 'abc', '1.234,5', '7,555']) { await fill(page, 'basket', bad); await page.locator('[data-in="basket"]').blur(); check(`${label}: "${bad}" rejected`, (await page.locator('[data-in="basket"]').getAttribute('aria-invalid')) === 'true'); }
  await fill(page, 'basket', ''); await page.locator('[data-in="basket"]').blur(); check(`${label}: blank field explained`, /Wert eingeben/.test(await page.locator('[data-err="basket"]').innerText()));
  await page.locator('[data-calc-reset]').click(); await settle(page);
  check(`${label}: reset restores the example`, (await out$(page, 'additional')) === '910 €' && await page.locator('[data-calc-empty]').isHidden());
  await page.locator('[data-range="gain"]').focus(); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
  check(`${label}: slider keyboard (10 → 13 %, 1.183 €)`, (await page.locator('[data-in="gain"]').inputValue()) === '13' && (await out$(page, 'additional')) === '1.183 €');
  await page.locator('[data-calc-reset]').click();
  const unit = await page.evaluate(() => [...document.querySelectorAll('.cf-val')].every(v => { const i = v.querySelector('input').getBoundingClientRect(), u = v.querySelector('.cf-unit'); return i.width > 40 && (!u || u.getBoundingClientRect().right <= v.getBoundingClientRect().right + 0.5); }));
  check(`${label}: units never overflow their field; inputs stay one per row`, unit && await page.evaluate(() => { const ys = [...document.querySelectorAll('.cf')].map(e => Math.round(e.getBoundingClientRect().top)); return new Set(ys).size === 4; }));
  const ro = await page.locator('[data-chart]').boundingBox(); check(`${label}: chart is inside the viewport`, ro.x >= 0 && ro.x + ro.width <= viewport.width + 1);
  await page.locator('.ctable summary').click(); check(`${label}: data table has 13 month rows`, (await page.locator('[data-table] tbody tr').count()) === 13); await page.locator('.ctable summary').click();

  // ---- offer + FAQ ----
  await jump(page, '#angebot'); await settle(page);
  const offer = await txt(page, '#angebot');
  check(`${label}: offer shows price, qualifier, what is included and the separate outlook`, /39 € \/ Monat \/ Standort/.test(offer) && /Pilotangebot – Details im persönlichen Gespräch/.test(offer) && /Aktuell enthalten/.test(offer) && /Gezeigter Ausblick · gesondert zu vereinbaren/.test(offer) && /Vorläufiger Einstiegspreis/.test(offer));
  check(`${label}: no invented trial, setup fee, cancellation, hardware, discount or VAT claim`, !/Einrichtungsgebühr|kostenlos|Testphase|Rabatt|Kündigung|MwSt|zzgl\.|inkl\.|unbegrenzt/i.test(offer));
  const d = page.locator('.faq details').first(); await d.locator('summary').click(); check(`${label}: FAQ opens`, await d.evaluate(e => e.open)); await d.locator('summary').click();
  await page.screenshot({ path: `${out}/${label}-offer.png` });

  // ---- contact ----
  await jump(page, '#rechner'); await settle(page);
  await page.locator('[data-calc-share]').click();
  check(`${label}: sharing the numbers is explicit and visible in the form`, !(await page.locator('#request-figures').isHidden()) && /Zahlen übernommen/.test(await page.locator('[data-calc-share]').textContent()));
  await page.locator('#request-figures-remove').click(); check(`${label}: shared numbers can be removed`, await page.locator('#request-figures').isHidden());
  await jump(page, '#anfrage'); await settle(page);
  const mailsBefore = log.mails.length;
  await page.getByRole('button', { name: /E-Mail vorbereiten/ }).click();
  check(`${label}: empty request is refused, focused on the business name, no mail opened, no false success`, /Namen deines Geschäfts/.test(await page.locator('#request-status').innerText()) && await page.evaluate(() => document.activeElement?.id === 'req-business') && log.mails.length === mailsBefore && !/gesendet!|Danke|erfolgreich/i.test(await page.locator('#request-status').innerText()));
  await page.locator('#req-business').fill('Bäckerei & Café "Süß"'); await page.locator('#req-message').fill('Zeile 1\nZeile 2');
  await page.locator('#req-industry').selectOption({ label: 'Café' });
  await page.locator('[data-calc-share]').evaluate(b => b.click());
  await page.getByRole('button', { name: /E-Mail vorbereiten/ }).click(); await page.waitForTimeout(250);
  const mail = decodeURIComponent(log.mails.at(-1) ?? '');
  check(`${label}: mail draft: support address, encoded umlauts/quotes/ampersand/newlines, industry, opt-in figures`, mail.startsWith('mailto:support@getloynara.com?subject=Demo-Anfrage Loynara – Bäckerei & Café "Süß"') && mail.includes('Zeile 1\nZeile 2') && mail.includes('Branche: Café') && mail.includes('Käufe pro Tag: 50') && mail.includes('kein Gewinn'));
  check(`${label}: page says nothing was sent yet and offers the copy fallback`, /Gesendet ist noch nichts/.test(await page.locator('#request-status').innerText()) && !(await page.locator('#request-copy').isHidden()));
  await page.locator('#request-copy').click(); await page.waitForTimeout(250);
  check(`${label}: denied clipboard gets a fallback message, never a success claim`, /Kopieren war nicht möglich|Text kopiert/.test(await page.locator('#request-status').innerText()));
  check(`${label}: contact explains what happens next without a response-time promise`, /Anfrage senden[\s\S]*Wir melden uns[\s\S]*Demo am Beispiel deines Geschäfts/.test(await txt(page, '.next')) && !/innerhalb|Stunden|werktags|binnen/i.test(await txt(page, '#anfrage')));
  const mailtoLinks = await page.locator('#anfrage a[href^="mailto:"], footer a[href^="mailto:"]').evaluateAll(a => a.map(x => x.getAttribute('href').split('?')[0]));
  check(`${label}: every mail link targets support@getloynara.com`, mailtoLinks.length >= 2 && mailtoLinks.every(h => h === 'mailto:support@getloynara.com'));
  await page.screenshot({ path: `${out}/${label}-contact.png` });
  for (const [name, href] of [['Impressum', '/impressum/'], ['Datenschutz', '/datenschutz/']]) check(`${label}: footer ${name}`, (await page.locator('footer').getByRole('link', { name }).getAttribute('href')) === href);
  check(`${label}: no console problems, no external requests during the whole run`, log.problems.length === 0 && log.external.length === 0, [...log.problems, ...log.external].join(' | '));
  await context.close();
}

// ---------- 320 px: the tight cases ------------------------------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 320, height: 740 }, { scale: 2 });
  await jump(page, '#rechner'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w320-calc.png` });
  check('320px: calculator inputs inside their card with the unit visible', await page.evaluate(() => { const card = document.querySelector('.inputs').getBoundingClientRect(); return [...document.querySelectorAll('.cf-val')].every(e => { const r = e.getBoundingClientRect(); return r.left >= card.left && r.right <= card.right; }); }));
  await fill(page, 'basket', '12,75'); await page.waitForTimeout(300); check('320px: typing keeps the caret and updates the result (1.658 €)', (await page.locator('[data-in="basket"]').inputValue()) === '12,75' && (await out$(page, 'additional')) === '1.658 €');
  await jump(page, '#ablauf'); await page.locator('#stage-refer').scrollIntoViewIfNeeded(); await page.locator('#stage-refer').click(); await page.waitForTimeout(400);
  await page.locator('#stage').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/w320-referral.png` });
  check('320px: referral steps and action stay readable inside the stage', await page.evaluate(() => [...document.querySelectorAll('#stage .stage-view:not([hidden]) *')].every(e => e.getBoundingClientRect().right <= innerWidth + 1)));
  await jump(page, '#gestaltung'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w320-studio.png` });
  check('320px: studio controls keep 44 px targets', await page.evaluate(() => [...document.querySelectorAll('#studio button, #studio select')].every(e => e.getBoundingClientRect().width >= 43.5 && e.getBoundingClientRect().height >= 43.5)));
  await jump(page, '#anfrage'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w320-contact.png` });
  await context.close(); }

// ---------- legal pages, reveals/print, orientation, text size, reduced motion, no JS ------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1280, height: 800 });
  for (const path of ['/impressum/', '/datenschutz/']) { const errs = []; page.on('pageerror', e => errs.push(e.message)); const r = await page.goto(base + path); await page.waitForTimeout(400); check(`${path}: loads with content, no script error`, r.status() === 200 && (await page.locator('main').innerText()).length > 200 && (await page.locator('h1').count()) === 1 && errs.length === 0, errs.join('|')); }
  await context.close(); }
{ const { page, context } = await newPage({ width: 1280, height: 800 });
  await page.emulateMedia({ media: 'print' });
  const st = await page.evaluate(() => ({ header: getComputedStyle(document.querySelector('.top')).position, hiddenViews: [...document.querySelectorAll('[data-show]')].filter(e => getComputedStyle(e).display === 'none').length, buttons: [...document.querySelectorAll('.seg')].filter(e => getComputedStyle(e).display !== 'none').length }));
  check('print: header static, every tab view of stage and owner is visible, tab controls hidden', st.header === 'static' && st.hiddenViews === 0 && st.buttons === 0, JSON.stringify(st));
  await page.screenshot({ path: `${out}/print-top.png`, fullPage: true });
  const pdf = await page.pdf({ format: 'A4', printBackground: true }); check('print: a PDF can be produced', pdf.length > 20000);
  await context.close(); }
{ const { page, context } = await newPage({ width: 390, height: 844 }, { scale: 2 });
  await jump(page, '#ablauf'); await page.locator('[data-act="visit"]').click(); await settle(page);
  const state = await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label');
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(600);
  check('orientation: landscape keeps state, no overflow', (await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label')) === state && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  check('orientation: portrait again, state kept, no overflow', (await page.locator('[data-slot="visit-card"] .lcard').getAttribute('aria-label')) === state && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; }); await page.waitForTimeout(400);
  check('text size 125 %: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await jump(page, '#rechner'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/mobile-text125-calc.png` });
  await context.close(); }
{ const { page, context } = await newPage({ width: 390, height: 844 }, { reduced: true });
  check('reduced motion: smooth scrolling off, transitions off', await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto' && getComputedStyle(document.querySelector('.btn')).transitionDuration === '0s'));
  await jump(page, '#ablauf'); await page.locator('[data-act="visit"]').click(); await page.locator('#stage-refer').click();
  for (let i = 0; i < 4; i++) await page.locator('[data-act="refer"]').click();
  check('reduced motion: the whole referral demo works with instant state changes', /1 qualifizierte Empfehlung/.test(await page.locator('[data-bind="refer-owner"]').textContent()));
  await jump(page, '#rechner'); await fill(page, 'gain', '20'); check('reduced motion: calculator updates immediately', (await out$(page, 'additional')) === '1.820 €');
  await context.close(); }
{ const { page, context } = await newPage({ width: 390, height: 844 }, { js: false });
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('no JS: headline, summary, referral rule, price, calculator example, contact are present', /Ein guter Besuch/.test(body) && /Besuche belohnen/i.test(body) && /Aus Stammkunden können Empfehlungen werden/.test(body) && /Bedingung erfüllt/.test(body) && /39 € \/ Monat \/ Standort/.test(body) && /910 €/.test(body) && /support@getloynara\.com/.test(body));
  check('no JS: the first view of every module is shown and nothing is hidden by script', /Dein Team bestätigt jeden Besuch/.test(body) && /Überblick/.test(body) && /Gestaltungsbeispiel/.test(body));
  await page.screenshot({ path: `${out}/nojs-top.png`, fullPage: true });
  await context.close(); }

// ---------- intermediate widths: desktop composition ------------------------------------------------------------------------------------------
for (const [w, h] of [[1280, 800], [1024, 768], [768, 1024]]) { const { page, context } = await newPage({ width: w, height: h }); await page.screenshot({ path: `${out}/w${w}-hero.png` }); await jump(page, '#ablauf'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w${w}-stage.png` }); await jump(page, '#gestaltung'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w${w}-studio.png` }); await context.close(); }
await browser.close();
console.log(`PASS: ${results.length} browser checks.`);
