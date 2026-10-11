// Renders HTML files to PDF (A4) and PNG previews with the system Chrome. Usage: node render.mjs <in.html> <out.pdf> [<out.png>]
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [input, pdf, png] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
if (png) await page.screenshot({ path: png, fullPage: true });
await browser.close();
