// Automated WCAG 2.x A/AA checks with axe-core. Automated rules find only part of the problems; no screen reader was used.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const base = process.env.BASE ?? 'http://127.0.0.1:8765';
const axe = resolve(import.meta.dirname, 'node_modules/axe-core/axe.min.js');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failures = 0;
for (const [label, viewport, path, setup] of [
  ['desktop home', { width: 1440, height: 900 }, '/', null], ['mobile home', { width: 390, height: 844 }, '/', null],
  ['desktop home, demo + calculator open', { width: 1440, height: 900 }, '/', async p => { await p.locator('[data-action="open-nfc"]').click(); await p.locator('[data-action="confirm"]').click(); await p.locator('.data-table summary').click(); await p.locator('#chart').focus(); await p.keyboard.press('End'); await p.locator('#moment-action').click(); await p.locator('.faq details').first().locator('summary').click(); }],
  ['mobile invalid input', { width: 390, height: 844 }, '/', async p => { await p.locator('#in-basket').fill('-3'); await p.locator('#in-basket').blur(); }],
  ['impressum', { width: 1280, height: 800 }, '/impressum/', null], ['datenschutz', { width: 1280, height: 800 }, '/datenschutz/', null],
]) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, bypassCSP: true }); const page = await ctx.newPage();
  await page.goto(base + path); await page.waitForTimeout(700);
  const h = await page.evaluate(() => document.documentElement.scrollHeight); for (let y = 0; y < h; y += 600) { await page.evaluate(v => scrollTo(0, v), y); await page.waitForTimeout(40); } await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(600);
  if (setup) await setup(page);
  await page.addScriptTag({ path: axe });
  const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0].target.join(' ') + ' :: ' + (v.nodes[0].failureSummary ?? '').slice(0, 160) })));
  console.log(`${label}: ${res.length === 0 ? 'no violations' : JSON.stringify(res, null, 1)}`); failures += res.filter(v => v.impact === 'serious' || v.impact === 'critical').length;
  await ctx.close();
}
await browser.close();
console.log(failures ? `SERIOUS/CRITICAL: ${failures}` : 'No serious or critical automated violations.');
process.exit(failures ? 1 : 0);
