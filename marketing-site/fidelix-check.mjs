// Public, read-only observation of https://fidelix.ma (no copying of code or assets): ranges, editability, keyboard, formula, graph presence.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const out = 'marketing-site/evidence/fidelix'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {};
for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto('https://fidelix.ma/', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const r = {};
  r.inputs = await page.evaluate(() => [...document.querySelectorAll('input')].filter(i => i.id.startsWith('roi-')).map(i => ({ id: i.id, type: i.type, min: i.min, max: i.max, step: i.step, value: i.value })));
  r.editableNumberFields = await page.evaluate(() => document.querySelectorAll('#roi-clients ~ input[type=number], input[type=number][id^=roi]').length);
  r.resetControl = await page.getByRole('button', { name: /réinit|reset|remettre/i }).count();
  const root = page.locator('#roi-clients').locator('xpath=ancestor::section[1]');
  await root.scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
  const read = async () => (await root.innerText()).replace(/\s+/g, ' ');
  const val = async id => page.locator(`#${id}`).inputValue();
  await page.locator('#roi-clients').focus(); const k0 = await val('roi-clients'); await page.keyboard.press('ArrowRight'); const k1 = await val('roi-clients'); await page.keyboard.press('End'); const k2 = await val('roi-clients'); await page.keyboard.press('Home'); const k3 = await val('roi-clients');
  r.keyboard = { start: k0, afterArrowRight: k1, afterEnd: k2, afterHome: k3 };
  r.svgPathsInCalculator = await root.locator('svg path, svg polyline, svg line').count();
  r.chartLikeElements = await root.locator('canvas, [role=img] svg, table').count();
  r.sample = (await read()).slice(0, 600);
  await root.screenshot({ path: `${out}/${label}-calculator.png` });
  report[label] = r;
  await page.close();
}
await writeFile(`${out}/observations.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1).slice(0, 2500));
await browser.close();
