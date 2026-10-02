import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Needs `npm run marketing:preview` running (loopback, port 8765). Local Chromium emulation only: no physical phone, no screen reader.
const base = 'http://127.0.0.1:8765', out = 'marketing-site/evidence/functional';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok = true) => { assert.ok(ok, name); results.push(name); };
const inView = async (page, selector, height) => { for (let i = 0; i < 30; i++) { const box = await page.locator(selector).boundingBox(); if (box && box.y < height && box.y + box.height > 0) return true; await page.waitForTimeout(100); } return false; };
const industries = ['cafe', 'barber', 'friseur', 'nagelstudio', 'gastro', 'autopflege', 'fitness', 'wellness'];

for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage();
  const problems = [], external = [], mails = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('request', r => { if (r.url().startsWith('mailto:')) mails.push(r.url()); else if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(base + '/');
  check(`${label}: title and h1`, (await page.title()).startsWith('Loynara') && (await page.locator('h1').innerText()).includes('Stammkunden'));
  check(`${label}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

  // navigation: every header link lands on a visible section
  for (const [name, id] of [['So funktioniert’s', 'ablauf'], ['NFC', 'nfc'], ['Funktionen', 'funktionen'], ['Demo', 'demo'], ['Preis', 'preis'], ['Fragen', 'faq']]) {
    if (mobile) await page.getByRole('button', { name: /Menü/ }).click();
    await page.locator('#main-nav').getByRole('link', { name, exact: true }).click();
    check(`${label}: nav "${name}" reaches #${id}`, await inView(page, `#${id}`, viewport.height));
    check(`${label}: menu closes after navigation`, !mobile || (await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'false');
  }
  // CTAs
  if (mobile) await page.getByRole('button', { name: /Menü/ }).click();
  check(`${label}: Anmelden → app login`, (await page.locator('#main-nav').getByRole('link', { name: 'Anmelden' }).getAttribute('href')) === 'https://app.getloynara.com/login');
  if (mobile) await page.getByRole('button', { name: /Menü/ }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole('link', { name: /Demo ansehen/ }).first().click(); 
  check(`${label}: hero "Demo ansehen" → demo`, await inView(page, '#demo', viewport.height));
  await page.evaluate(() => scrollTo(0, 0));
  check(`${label}: hero Anmelden`, (await page.locator('.hero').getByRole('link', { name: 'Anmelden' }).getAttribute('href')) === 'https://app.getloynara.com/login');
  await page.locator('#preis').getByRole('link', { name: /Demo anfragen/ }).click(); 
  check(`${label}: price CTA → request form`, await inView(page, '#anfrage', viewport.height));
  check(`${label}: price shown as €39 per location per month`, /39 €\s*\/ Monat \/ Standort/.test(await page.locator('#preis').innerText()) && /Pilotangebot – Details im persönlichen Gespräch/.test(await page.locator('#preis').innerText()));

  // demo: every industry, both entry paths
  await page.locator('#demo').scrollIntoViewIfNeeded();
  for (const key of industries) {
    const choice = page.locator(`[data-industry-choice="${key}"]`);
    check(`${label}: ${key} selector enabled`, await choice.isEnabled());
    await choice.click();
    const name = await page.locator('#industry-panel h3').innerText();
    check(`${label}: ${key} panel and demo card agree`, name.length > 3 && (await page.locator('#demo-screens .demo-card .card-top span').first().innerText()) === name);
    const th = await page.locator('#demo-screens .customer .stamp').count();
    for (const entry of key === 'cafe' ? ['nfc', 'qr'] : ['nfc']) {
      await page.locator('#demo-reset').click();
      await page.locator(`#demo-screens [data-action="${entry}"]`).click();
      await page.locator('#demo-next').click();
      await page.locator('#demo-screens [data-action="enroll"]').click();
      await page.locator('#demo-next').click();
      if (entry === 'qr') { check(`${label}: qr cannot confirm before scan`, await page.locator('[data-action="confirm"]').count() === 0); await page.locator('[data-action="scan"]').click(); }
      await page.locator('[data-action="confirm"]').click();
      check(`${label}: ${key}/${entry} confirm gives 1 stamp`, (await page.locator('#demo-screens .customer .card-total strong').innerText()).startsWith('1'));
      check(`${label}: confirm cannot be repeated`, await page.locator('[data-action="confirm"]').count() === 0);
      await page.locator('#demo-next').click();
      await page.locator('[data-action="more"]').click();
      check(`${label}: ${key} reaches ${th}/${th}`, (await page.locator('#demo-screens .customer .card-total strong').innerText()).startsWith(String(th)));
      await page.locator('[data-action="redeem"]').click();
      check(`${label}: ${key}/${entry} redeem resets to 0`, (await page.locator('#demo-screens .customer .card-total strong').innerText()).startsWith('0') && /eingelöst/.test(await page.locator('#demo-screens .owner').innerText()));
    }
  }
  await page.screenshot({ path: `${out}/${label}-demo.png`, fullPage: false });

  // request form: refuses empty, prepares mail, no silent success
  await page.locator('#anfrage').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /E-Mail vorbereiten/ }).click();
  check(`${label}: empty request is refused visibly`, /Namen deines Geschäfts/.test(await page.locator('#request-status').innerText()) && (await page.locator('#request-status').getAttribute('role')) === 'alert');
  await page.locator('#req-business').fill('Café Beispiel');
  await page.getByRole('button', { name: /E-Mail vorbereiten/ }).click();
  check(`${label}: request states that nothing is sent yet`, /Gesendet ist noch nichts/.test(await page.locator('#request-status').innerText()) && await page.locator('#request-copy').isVisible());
  check(`${label}: direct mail link`, (await page.locator('.request-card a[href^="mailto:"]').last().getAttribute('href')).startsWith('mailto:support@getloynara.com'));

  check(`${label}: the page opens exactly one mail draft to support@getloynara.com`, mails.length === 1 && mails[0].startsWith('mailto:support@getloynara.com?subject=Demo-Anfrage') && decodeURIComponent(mails[0]).includes('Geschäft: Café Beispiel'));

  // footer + legal slots
  for (const [name, href] of [['Impressum', '/impressum/'], ['Datenschutz', '/datenschutz/'], ['Teilnahmebedingungen', 'https://app.getloynara.com/teilnahmebedingungen']]) check(`${label}: footer ${name}`, (await page.locator('footer').getByRole('link', { name }).getAttribute('href')) === href);
  for (const path of ['/impressum/', '/datenschutz/']) { const r = await page.goto(base + path); check(`${label}: ${path} loads`, r.status() === 200 && (await page.locator('h1').count()) === 1); }
  await page.goto(base + '/');
  await page.screenshot({ path: `${out}/${label}-home.png`, fullPage: true });
  // dead controls: after JS has run, nothing but the first demo step's Back/Next may be disabled
  const disabled = await page.evaluate(() => [...document.querySelectorAll('button:disabled')].map(b => b.id || b.textContent.trim()));
  check(`${label}: no dead controls (disabled: ${disabled.join(',') || 'none'})`, disabled.every(id => ['demo-back', 'demo-next'].includes(id)));
  if (problems.length) console.log(problems);
  check(`${label}: no console errors/warnings`, problems.length === 0);
  if (external.length) console.log(external);
  check(`${label}: no external requests`, external.length === 0);
  await context.close();
}
// reduced motion + keyboard
const kb = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
await kb.goto(base + '/#demo');
await kb.locator('[data-industry-choice="friseur"]').focus(); await kb.keyboard.press('Enter');
check('keyboard: industry selectable', (await kb.locator('[data-industry-choice="friseur"]').getAttribute('aria-pressed')) === 'true');
await browser.close();
console.log(`PASS: ${results.length} browser checks (desktop 1440x900, mobile 390x844 emulation).`);
