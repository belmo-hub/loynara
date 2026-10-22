import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Concept D browser checks. Needs the loopback preview (PORT=8795 npm run marketing:preview).
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

// ---------- every viewport: structure, overflow, console, first viewport, default-visible value ---------------------------------------
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [430, 932], [390, 844], [375, 812], [360, 800], [320, 740]]) {
  const { page, context, log } = await newPage({ width: w, height: h });
  const tag = `${w}px`;
  check(`${tag}: one h1, title`, (await page.locator('h1').count()) === 1 && (await page.title()).startsWith('Loynara'));
  check(`${tag}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  const wide = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1 && !e.closest('details:not([open]), svg, .ctable, .hero-scene, .studio-scene'); }).slice(0, 5).map(e => `${e.tagName}.${e.className}`));
  check(`${tag}: nothing sticks out of the viewport`, wide.length === 0, wide.join(','));
  check(`${tag}: no console problems, no external requests`, log.problems.length === 0 && log.external.length === 0, [...log.problems, ...log.external].join(' | '));
  check(`${tag}: two tab modules with ARIA roles and roving tabindex`, (await page.locator('[role=tablist]').count()) === 2 && (await page.locator('[role=tab]').count()) === 5 && (await page.locator('[role=tabpanel]').count()) === 2 && (await page.locator('[role=tab][tabindex="0"]').count()) === 2);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('[role=tab], .btn')].filter(t => t.offsetParent && (t.scrollWidth > t.clientWidth + 1 || t.getBoundingClientRect().right > innerWidth + 1 || t.getBoundingClientRect().height < 40)).map(t => t.textContent));
  check(`${tag}: no clipped tab or button labels, every control at least 40 px high`, clipped.length === 0, clipped.join(','));
  const fv = await page.evaluate(() => { const vh = innerHeight, r = s => document.querySelector(s).getBoundingClientRect(); return { h1: r('h1').bottom <= vh, lead: r('.hero .lead').bottom <= vh, cta: r('.hero .btn-primary').bottom <= vh, product: r('.hero-scene').top < vh - 40 }; });
  check(`${tag}: first viewport: headline, sentence, primary CTA and the start of the product scene`, fv.h1 && fv.lead && fv.cta && fv.product, JSON.stringify(fv));
  const objects = await page.evaluate(() => { const r = document.querySelector('.hero-scene').getBoundingClientRect(); return [...document.querySelectorAll('.hero-scene .phone, .hero-scene .stand-obj')].map(e => e.getBoundingClientRect()).every(o => o.width > 90 && o.left >= r.left - 1 && o.right <= r.right + 1); });
  check(`${tag}: hero product objects are large and inside their scene`, objects);
  const dv = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => e.getClientRects().length && !e.closest('[hidden]')).map(e => e.textContent).join(' ').replace(/\s+/g, ' '));
  for (const re of [/Kunde/, /Team/, /Inhaber/, /Karte öffnen/, /Team bestätigt/, /Prämie einlösen/, /Deine Stammkunden bringen den nächsten Kunden mit/, /Bonus verbucht/, /keinen Bonus/, /Wer kommt wieder\?/, /Wer fehlt\?/, /Wann ist es ruhig\?/, /Gestaltungsbeispiel/, /Wallet-Vorschau/, /49 €/, /pro Monat und Standort/, /Demo anfragen/]) check(`${tag}: visible by default: ${re}`, re.test(dv));
  await context.close();
}

// ---------- functional runs: desktop + mobile ----------------------------------------------------------------------------------------
for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
  const { page, context, log } = await newPage(viewport, { scale: mobile ? 2 : 1 });
  await page.screenshot({ path: `${out}/${label}-hero.png` });
  await page.locator('.hero .btn-primary').click(); await page.waitForTimeout(1300);
  const reached = await page.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById('anfrage').getBoundingClientRect().top) }));
  check(`${label}: hero "Demo anfragen" scrolls to the contact section and does not open a mail client`, reached.hash === '#anfrage' && reached.top < 200 && log.mails.length === 0, JSON.stringify(reached));
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  await page.locator('.hero .btn-ghost').click(); await page.waitForTimeout(1300);
  check(`${label}: "So funktioniert’s" reaches the counter scene`, (await page.evaluate(() => location.hash)) === '#ablauf');
  check(`${label}: login is a quiet link to the app`, (await page.locator('.login').getAttribute('href')) === 'https://app.getloynara.com/login' && !(await page.locator('.login').evaluate(e => e.classList.contains('btn'))));
  if (!mobile) for (const [name, id] of [['Ablauf', 'ablauf'], ['Empfehlungen', 'empfehlung'], ['Gestaltung', 'gestaltung'], ['Inhaber', 'inhaber'], ['Rechner', 'rechner'], ['Preis', 'angebot']]) { await page.locator('.mainnav').getByRole('link', { name, exact: true }).click(); await page.waitForTimeout(1200); check(`${label}: nav "${name}" reaches #${id}`, await page.evaluate(i => Math.abs(document.getElementById(i).getBoundingClientRect().top) < 260, id)); }

  // ---- counter demo ----
  await jump(page, '#ablauf'); await page.waitForTimeout(300);
  const card = () => page.locator('.phone-stage .lcard').getAttribute('aria-label').then(t => Number(t.match(/(\d+) von 10/)[1]));
  const owner = () => txt(page, '[data-bind="visit-owner"]');
  const act = page.locator('[data-act="visit"]');
  const lit = () => page.locator('.visit-steps li.done').count();
  check(`${label}: counter demo starts at 8/10, nothing confirmed`, await card() === 8 && /0 bestätigte Besuche · 0 Prämien eingelöst/.test(await owner()) && (await act.textContent()) === 'Karte öffnen');
  await act.click(); await settle(page);
  check(`${label}: opening the card does not stamp; the request waits for the team`, await card() === 8 && /Dein Team scannt und bestätigt/.test(await txt(page, '.phone-stage')) && (await act.textContent()) === 'Besuch bestätigen' && await lit() === 1);
  await act.click(); await settle(page);
  check(`${label}: confirmation adds exactly one stamp (9/10) and the owner sees it`, await card() === 9 && /1 bestätigter Besuch · 0 Prämien eingelöst/.test(await owner()) && /Stempel erhalten/.test(await txt(page, '.phone-stage')));
  await page.screenshot({ path: `${out}/${label}-visit-confirmed.png` });
  await act.click(); await settle(page); await act.click(); await settle(page);
  check(`${label}: second confirmed visit reaches 10/10 and the reward is ready`, await card() === 10 && /Prämie bereit/.test(await txt(page, '.phone-stage')) && (await act.textContent()) === 'Prämie einlösen');
  await act.click(); await settle(page);
  check(`${label}: redemption resets the card to 0/10; the owner sees two visits and one redemption`, await card() === 0 && /2 bestätigte Besuche · 1 Prämie eingelöst/.test(await owner()));
  await act.click(); await settle(page);
  check(`${label}: "Von vorn" returns to 8/10`, await card() === 8 && /0 bestätigte Besuche/.test(await owner()));
  await page.locator('[data-new-card]').click(); await settle(page);
  check(`${label}: new card: no card and no stamps before it is created`, (await page.locator('.phone-stage .lcard').count()) === 0 || await card() === 0);
  await act.click(); await settle(page);
  check(`${label}: new card: creation is a separate step`, /Neue Karte erstellen/.test(await txt(page, '.phone-stage')) && (await act.textContent()) === 'Karte erstellen');
  await act.click(); await settle(page); check(`${label}: new card created at 0/10, waiting for confirmation`, await card() === 0);
  await act.click(); await settle(page); check(`${label}: new card: first confirmed visit = exactly 1/10, no jump to a reward`, await card() === 1 && /Bis zur Prämie braucht sie zehn bestätigte Besuche/.test(await txt(page, '[data-bind="visit-caption"]')));
  await page.locator('[data-new-card]').click(); await settle(page);
  check(`${label}: back to the returning card at 8/10`, await card() === 8);

  // ---- referral ----
  await jump(page, '#empfehlung'); await settle(page);
  const a = () => page.locator('.person-a .stamps-num span').textContent().then(Number);
  const refAct = page.locator('[data-act="ref"]'), refOwner = () => txt(page, '[data-bind="ref-owner"]');
  await page.screenshot({ path: `${out}/${label}-referral-0.png` });
  for (let i = 0; i < 3; i++) { const l = await refAct.textContent(); await refAct.click(); await settle(page); check(`${label}: referral "${l}" earns nothing (Lena stays at 7, no bonus)`, await a() === 7 && /0 qualifizierte Empfehlungen/.test(await refOwner()) && /kein Bonus/.test(await txt(page, '.person-a'))); }
  check(`${label}: joined: two steps lit, next action is the first confirmed visit`, (await page.locator('.ref-steps li.done').count()) === 2 && (await refAct.textContent()) === 'Ersten Besuch bestätigen');
  await refAct.click(); await settle(page);
  check(`${label}: qualification books exactly one bonus (7 → 8), friend at 1/10, owner sees one qualified referral`, await a() === 8 && (await page.locator('.person-b .stamps-num span').textContent()) === '1' && /1 qualifizierte Empfehlung · 1 Bonus verbucht/.test(await refOwner()) && await refAct.isDisabled());
  await refAct.click({ force: true }).catch(() => {}); await settle(page); check(`${label}: no duplicate bonus`, await a() === 8);
  await page.screenshot({ path: `${out}/${label}-referral-qualified.png` });
  await page.locator('[data-reset="ref"]').click(); await settle(page);
  check(`${label}: referral reset`, await a() === 7 && /0 qualifizierte Empfehlungen/.test(await refOwner()));

  // ---- brand studio ----
  await jump(page, '#gestaltung'); await settle(page);
  await jump(page, '#ablauf'); await act.click(); await act.click(); await settle(page);   // loyalty state 9/10, to prove independence
  await jump(page, '#rechner'); await fill(page, 'gain', '15'); await settle(page);
  await jump(page, '#gestaltung'); await settle(page);
  const colours = () => page.evaluate(() => [...document.querySelectorAll('#studio .so-face, #studio .lcard, #studio .wpass')].map(e => getComputedStyle(e).getPropertyValue('--b-dark').trim()));
  check(`${label}: studio default shows the physical pair: stand + card in the browser`, (await page.locator('#studio .stand-obj').count()) === 1 && (await page.locator('#studio .lcard').count()) === 1 && (await page.locator('#studio .wpass').count()) === 0);
  for (const [k, hex] of Object.entries({ wald: '#143D2E', terrakotta: '#7A3320', nachtblau: '#16264A', pflaume: '#4A1D44', graphit: '#1C2326' })) {
    await page.locator(`[data-brand-style="${k}"]`).click(); await page.waitForTimeout(220);
    const c = await colours(); check(`${label}: colour ${k}: stand and card share ${hex}`, c.length === 2 && c.every(v => v === hex), c.join('/'));
    await page.locator('#screen-wallet').click(); await page.waitForTimeout(220);
    const w = await colours(); check(`${label}: colour ${k}: stand and Wallet-Vorschau share ${hex}`, w.length === 2 && w.every(v => v === hex), w.join('/'));
    await page.locator('#screen-karte').click(); await page.waitForTimeout(150);
    await page.locator('#studio').screenshot({ path: `${out}/${label}-studio-${k}.png` });
  }
  for (const logo of ['blatt', 'welle', 'monogramm']) { await page.locator(`[data-brand-logo="${logo}"]`).click(); await page.waitForTimeout(150); check(`${label}: logo ${logo} on stand and card`, (await page.locator('#studio .so-logo').count()) === 1 && (await page.locator('#studio .lc-logo svg').count()) === 1 && (await page.locator(`[data-brand-logo="${logo}"]`).getAttribute('aria-pressed')) === 'true'); }
  for (const [r, word] of [['aufmerksamkeit', 'Aufmerksamkeit'], ['extra', 'Extra zum nächsten Besuch'], ['branche', 'Kaffee aufs Haus']]) { await page.selectOption('#brand-reward', r); await page.waitForTimeout(150); check(`${label}: reward ${r} reaches the card`, (await txt(page, '#studio .lcard')).includes(word)); }
  await page.locator('#screen-karte').focus(); await page.keyboard.press('ArrowRight');
  check(`${label}: screen tabs: ArrowRight selects the Wallet-Vorschau and keeps focus`, (await page.locator('#screen-wallet').getAttribute('aria-selected')) === 'true' && await page.evaluate(() => document.activeElement?.id === 'screen-wallet') && (await page.locator('#studio .wpass').count()) === 1);
  await page.keyboard.press('Home');
  check(`${label}: brand changes leave the loyalty demo (9/10) and the calculator (15 % → 1.365 €) untouched`, await card() === 9 && (await page.locator('[data-in="gain"]').inputValue()) === '15' && (await out$(page, 'additional')) === '1.365 €');
  check(`${label}: the studio makes no request and writes no storage`, log.external.length === 0 && await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''));
  await page.locator('[data-brand-style="wald"]').click();

  // ---- owner ----
  await jump(page, '#inhaber'); await settle(page);
  check(`${label}: owner opens on "Wer kommt wieder?" with example data`, (await selected(page, '[data-tabs="owner"] [role=tab]')).join() === 'back' && /Beispieldaten/i.test(await txt(page, '#owner')) && /12/.test(await txt(page, '#owner')));
  await page.screenshot({ path: `${out}/${label}-owner-back.png` });
  for (const v of ['gone', 'quiet']) {
    await page.locator(`#owner-${v}`).click(); await settle(page);
    const t = await txt(page, '#owner');
    check(`${label}: owner ${v}: one view, labelled Plattform-Ausblick, message is an unsent preview`, /Plattform-Ausblick/i.test(t) && /Vorschau · nicht versendet/i.test(t) && !/wurde gesendet|zurückgekehrt/i.test(t) && (await page.locator('#owner .ov:not([hidden])').count()) === 1);
    await page.screenshot({ path: `${out}/${label}-owner-${v}.png` });
  }
  await page.locator('#owner-back').focus(); await page.keyboard.press('End');
  check(`${label}: owner tabs: End selects "Wann ist es ruhig?"`, (await selected(page, '[data-tabs="owner"] [role=tab]')).join() === 'quiet' && await page.evaluate(() => document.activeElement?.id === 'owner-quiet'));
  await page.keyboard.press('Home');
  // ---- calculator ----
  await page.locator('[data-calc-reset]').click(); await jump(page, '#rechner'); await settle(page);
  await page.locator('.more summary').click();
  check(`${label}: calculator default: 910 / 9.100 / 49 / +861 / +10.332 / ratio 18,6×`, (await out$(page, 'additional')) === '910 €' && (await out$(page, 'baseline')) === '9.100 €' && (await out$(page, 'fee')) === '49 €' && (await out$(page, 'difference')) === '+861 €' && (await out$(page, 'annualised')) === '+10.332 €' && (await out$(page, 'ratio')) === '18,6×');
  check(`${label}: ratio is only inside the details`, await page.evaluate(() => !!document.querySelector('.more [data-out="ratio"]') && !document.querySelector('.result [data-out="ratio"]')));
  await page.locator('.more summary').click();
  check(`${label}: chart label "+10.920 € Zusatzumsatz" (before fee)`, /\+10\.920 € Zusatzumsatz/.test(await page.locator('[data-chart]').innerHTML()));
  await page.screenshot({ path: `${out}/${label}-calc-default.png` });
  await fill(page, 'basket', '7,50'); await settle(page);
  check(`${label}: comma decimals (975 € / +926 €)`, (await out$(page, 'additional')) === '975 €' && (await out$(page, 'difference')) === '+926 €');
  await fill(page, 'basket', '7'); await fill(page, 'gain', '0'); await settle(page);
  check(`${label}: 0 % is not softened: 0 €, −49 €, −588 €, ratio 0×, fee-exceeds note shown, result card not green`, (await out$(page, 'additional')) === '0 €' && (await out$(page, 'difference')) === '−49 €' && (await out$(page, 'annualised')) === '−588 €' && (await out$(page, 'ratio')) === '0×' && await page.locator('[data-zero-note]').isVisible() && await page.evaluate(() => getComputedStyle(document.querySelector('.result')).backgroundColor !== 'rgb(20, 61, 46)') && (await page.locator('[data-calc].is-negative').count()) === 1 && (await page.locator('[data-chart] .gaplabel').count()) === 0);
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
  check(`${label}: offer shows price, qualifier, inclusions, outlook note and CTA`, /49 €/.test(offer) && /pro Monat und Standort/.test(offer) && /Pilotangebot – Details im persönlichen Gespräch/.test(offer) && /NFC-Antippen und QR-Einstieg am Tresen/.test(offer) && /Empfehlungen/.test(offer) && /als Ausblick und vereinbaren sie gesondert/.test(offer) && /Vorläufiger Einstiegspreis/.test(offer) && (await page.locator('.price-card .btn-primary').getAttribute('href')) === '#anfrage');
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
  await jump(page, '#empfehlung'); for (let i = 0; i < 4; i++) await page.locator('[data-act="ref"]').click(); await page.waitForTimeout(300);
  await page.locator('.ref-pair').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/w320-referral.png` });
  check('320px: referral picture, steps and action stay inside the viewport', await page.evaluate(() => [...document.querySelectorAll('#empfehlung *')].every(e => e.getBoundingClientRect().right <= innerWidth + 1)));
  await jump(page, '#hero'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/w320-hero.png` });
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
  check('print: header static, every owner view is visible, tab controls hidden', st.header === 'static' && st.hiddenViews === 0 && st.buttons === 0, JSON.stringify(st));
  await page.screenshot({ path: `${out}/print-top.png`, fullPage: true });
  const pdf = await page.pdf({ format: 'A4', printBackground: true }); check('print: a PDF can be produced', pdf.length > 20000);
  await context.close(); }
{ const { page, context } = await newPage({ width: 390, height: 844 }, { scale: 2 });
  await jump(page, '#ablauf'); await page.locator('[data-act="visit"]').click(); await page.locator('[data-act="visit"]').click(); await settle(page);
  const state = await page.locator('.phone-stage .lcard').getAttribute('aria-label');
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(600);
  check('orientation: landscape keeps state, no overflow', (await page.locator('.phone-stage .lcard').getAttribute('aria-label')) === state && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  check('orientation: portrait again, state kept, no overflow', (await page.locator('.phone-stage .lcard').getAttribute('aria-label')) === state && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; }); await page.waitForTimeout(400);
  check('text size 125 %: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await jump(page, '#rechner'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/mobile-text125-calc.png` });
  await context.close(); }
{ const { page, context } = await newPage({ width: 390, height: 844 }, { reduced: true });
  check('reduced motion: smooth scrolling off, transitions off', await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto' && getComputedStyle(document.querySelector('.btn')).transitionDuration === '0s'));
  await jump(page, '#ablauf'); await page.locator('[data-act="visit"]').click(); await page.locator('[data-act="visit"]').click();
  check('reduced motion: the counter demo works with instant state changes', /1\sbestätigter\sBesuch/.test(await page.locator('[data-bind="visit-owner"]').textContent()));
  await jump(page, '#empfehlung'); for (let i = 0; i < 4; i++) await page.locator('[data-act="ref"]').click();
  check('reduced motion: the referral demo works with instant state changes', /1\squalifizierte\sEmpfehlung/.test(await page.locator('[data-bind="ref-owner"]').textContent()));
  await jump(page, '#rechner'); await fill(page, 'gain', '20'); check('reduced motion: calculator updates immediately', (await out$(page, 'additional')) === '1.820 €');
  await context.close(); }
{ const { page, context } = await newPage({ width: 390, height: 844 }, { js: false });
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('no JS: headline, roles, counter flow, referral rule, price, calculator example and contact are present', /Ein guter Besuch/.test(body) && /Bestätigt den Besuch mit einem Tipp/.test(body) && /Karte öffnen/.test(body) && /keinen Bonus/.test(body) && /49 €/.test(body) && /910 €/.test(body) && /support@getloynara\.com/.test(body));
  check('no JS: the product objects and the first owner view are rendered', (await page.locator('.hero-scene .phone').count()) === 1 && (await page.locator('#studio .stand-obj').count()) === 1 && /12/.test(await page.locator('#owner').innerText()));
  await page.screenshot({ path: `${out}/nojs-top.png`, fullPage: true });
  await context.close(); }

// ---------- intermediate widths: desktop composition ------------------------------------------------------------------------------------------
for (const [w, h] of [[1280, 800], [1024, 768], [768, 1024]]) { const { page, context } = await newPage({ width: w, height: h }); await page.screenshot({ path: `${out}/w${w}-hero.png` }); await jump(page, '#ablauf'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w${w}-stage.png` }); await jump(page, '#gestaltung'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/w${w}-studio.png` }); await context.close(); }
await browser.close();
console.log(`PASS: ${results.length} browser checks.`);
