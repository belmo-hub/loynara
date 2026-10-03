import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homePage, legalPage, type LegalFragments } from './template.js';
import { SITE } from './src/site.js';

const here = import.meta.dirname, root = resolve(here, 'site');
const concepts = process.env.MARKETING_CONCEPTS === 'true';
if (concepts && process.env.MARKETING_PUBLIC === 'true') throw new Error('Concept prototypes cannot be part of a public build.');
const read = async (name: string) => { const file = resolve(here, 'legal', name); return existsSync(file) ? (await readFile(file, 'utf8')).trim() || null : null; };
const legal: LegalFragments = { impressum: await read('impressum.html'), datenschutz: await read('datenschutz.html') };
const missing = (['impressum', 'datenschutz'] as const).filter(k => !legal[k]);
if (process.env.MARKETING_PUBLIC === 'true' && missing.length) {
  throw new Error(`Public build blocked: approved legal text missing for ${missing.join(', ')} (marketing-site/legal/<name>.html, see LEGAL_LAUNCH_FIELDS.md).`);
}

await rm(resolve(root, 'assets/modules'), { recursive: true, force: true });
await rm(resolve(root, 'assets/app.js'), { force: true });
for (const dir of ['', 'impressum', 'datenschutz']) await mkdir(resolve(root, dir), { recursive: true });
await writeFile(resolve(root, 'index.html'), homePage());
await writeFile(resolve(root, 'impressum/index.html'), legalPage('impressum', legal));
await writeFile(resolve(root, 'datenschutz/index.html'), legalPage('datenschutz', legal));
await writeFile(resolve(root, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE.origin}/sitemap.xml\n`);
await writeFile(resolve(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`+`<url><loc>${SITE.origin}/</loc></url>${missing.includes('impressum') ? '' : `<url><loc>${SITE.origin}/impressum/</loc></url>`}${missing.includes('datenschutz') ? '' : `<url><loc>${SITE.origin}/datenschutz/</loc></url>`}</urlset>`);
await writeFile(resolve(root, '_headers'), `/*
  Cache-Control: public, max-age=0, must-revalidate, no-transform
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
`);
const { brandCss: finalBrandCss } = await import('./src/final-parts.js');
await writeFile(resolve(root, 'styles.css'), (await readFile(resolve(here, 'final/final.css'), 'utf8')) + '\n' + finalBrandCss() + '\n');

// Design-direction prototypes: only with MARKETING_CONCEPTS=true, never in a public build, never in the sitemap.
for (const dir of ['concepts', 'concept-a', 'concept-b', 'concept-c']) await rm(resolve(root, dir), { recursive: true, force: true });
await rm(resolve(root, 'concepts.css'), { force: true }); await rm(resolve(root, 'assets/concepts.js'), { force: true });
if (concepts) {
  const c = await import('./concepts/pages.js');
  for (const [dir, html] of [['concepts', c.conceptIndex()], ['concept-a', c.conceptA()], ['concept-b', c.conceptB()], ['concept-c', c.conceptC()]] as const) { await mkdir(resolve(root, dir), { recursive: true }); await writeFile(resolve(root, dir, 'index.html'), html); }
  await writeFile(resolve(root, 'concepts.css'), (await readFile(resolve(here, 'concepts/concepts.css'), 'utf8')) + '\n' + c.brandCss() + '\n');
}

const typecheck = spawnSync(resolve('node_modules/.bin/tsc'), ['-p', 'marketing-site/tsconfig.json'], { stdio: 'inherit' });
if (typecheck.status) process.exit(typecheck.status);
// One self-contained, minified browser file (Motion is bundled; the CSP allows only same-origin scripts).
const { build } = await import(resolve(here, 'node_modules/esbuild/lib/main.js'));
await build({ entryPoints: [resolve(here, 'src/final.ts')], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: resolve(root, 'assets/app.js'), legalComments: 'none', logLevel: 'warning' });
if (concepts) await build({ entryPoints: [resolve(here, 'src/concepts.ts')], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: resolve(root, 'assets/concepts.js'), legalComments: 'none', logLevel: 'warning' });
console.log(`Marketing build PASS: ${missing.length ? `3 static pages (legal text pending: ${missing.join(', ')})` : '3 static pages'}, no application/database dependency. Public mode: ${process.env.MARKETING_PUBLIC === 'true' ? 'enabled' : 'disabled'}.${concepts ? ' Concept prototypes: /concepts/ (noindex, not in sitemap).' : ''}`);
