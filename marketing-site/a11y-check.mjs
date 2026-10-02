// Automated WCAG 2.x A/AA checks with axe-core. Automated rules find only part of the problems; no screen reader was used.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const base = process.env.BASE ?? 'http://127.0.0.1:8765';
const axe = resolve(import.meta.dirname, 'node_modules/axe-core/axe.min.js');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failures = 0;
for (const [label, viewport, path, setup] of [
  ['desktop home', { width: 1440, height: 900 }, '/', null], ['mobile home', { width: 390, height: 844 }, '/', null],
  ['desktop home, journey, owner, studio, calculator and FAQ opened', { width: 1440, height: 900 }, '/', async p => { await p.locator('[data-action="open-nfc"]').click(); await p.locator('[data-chapter="collect"]').click(); await p.locator('[data-action="confirm"]').click(); await p.locator('[data-owner-view="quiet"]').click(); await p.locator('#owner-action').click(); await p.locator('#studio [data-brand-style="graphit"]').click(); await p.locator('.data-table summary').click(); await p.locator('.calc-assumptions summary').click(); await p.locator('#chart').focus(); await p.keyboard.press('End'); await p.locator('#angebot details').first().locator('summary').click(); }],
  ['desktop referral chapter after the bonus', { width: 1440, height: 900 }, '/', async p => { await p.locator('[data-chapter="refer"]').click(); for (const a of ['ref-share', 'ref-open', 'ref-join', 'ref-confirm']) await p.locator(`[data-action="${a}"]`).click(); }],
  ['desktop owner Zurückholen preview, terrakotta brand', { width: 1440, height: 900 }, '/', async p => { await p.locator('[data-owner-view="win"]').click(); await p.locator('#owner-action').click(); await p.locator('#studio [data-brand-style="terrakotta"]').click(); }],
  ['mobile journey and studio interactions', { width: 390, height: 844 }, '/', async p => { await p.locator('[data-action="open-qr"]').click(); await p.locator('[data-chapter="refer"]').click(); await p.locator('[data-owner-view="win"]').click(); await p.locator('#studio [data-brand-style="nachtblau"]').click(); }],
  ['mobile invalid input', { width: 390, height: 844 }, '/', async p => { await p.locator('#in-basket').fill('-3'); await p.locator('#in-basket').blur(); }],
  ['impressum', { width: 1280, height: 800 }, '/impressum/', null], ['datenschutz', { width: 1280, height: 800 }, '/datenschutz/', null],
]) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, bypassCSP: true }); const page = await ctx.newPage();
  await page.goto(base + path); await page.waitForTimeout(700);
  const h = await page.evaluate(() => document.documentElement.scrollHeight); for (let y = 0; y < h; y += 600) { await page.evaluate(v => scrollTo(0, v), y); await page.waitForTimeout(40); } await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(600);
  if (setup) { await setup(page); await page.waitForTimeout(800); }
  await page.addScriptTag({ path: axe });
  const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0].target.join(' ') + ' :: ' + (v.nodes[0].failureSummary ?? '').slice(0, 160) })));
  console.log(`${label}: ${res.length === 0 ? 'no violations' : JSON.stringify(res, null, 1)}`); failures += res.filter(v => v.impact === 'serious' || v.impact === 'critical').length;
  await ctx.close();
}
await browser.close();
console.log(failures ? `SERIOUS/CRITICAL: ${failures}` : 'No serious or critical automated violations.');
process.exit(failures ? 1 : 0);
