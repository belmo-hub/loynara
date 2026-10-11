// Renders an HTML file to PDF with the page size from @page and optional PNG per page. Usage: node render-html.mjs <in.html> <out.pdf> [<png-prefix> <pxPerMm>]
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [input, pdf, prefix, ppm = '3'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const px = 96 / 25.4;
const page = await browser.newPage({ viewport: { width: Math.ceil(420 * px), height: Math.ceil(297 * px) }, deviceScaleFactor: Number(ppm) / px });
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
if (prefix) { const n = await page.locator('.pg').count(); for (let i = 0; i < n; i++) await page.locator('.pg').nth(i).screenshot({ path: `${prefix}-${i + 1}.png` }); }
await browser.close();
