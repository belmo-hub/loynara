import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'site');
const walk=dir=>readdirSync(dir).flatMap(n=>statSync(resolve(dir,n)).isDirectory()?walk(resolve(dir,n)):[resolve(dir,n)]);
const pages=walk(root).filter(f=>f.endsWith('.html'));
for(const page of pages){const html=readFileSync(page,'utf8');const locale=page.slice(root.length).split('/')[1];const lang=locale==='en'||locale==='ar'?locale:'de';assert.ok(html.includes(`<html lang="${lang}" dir="${lang==='ar'?'rtl':'ltr'}">`),`Wrong page language: ${page}`);for(const alt of ['de','en','ar'])assert.ok(html.includes(`hreflang="${alt}"`));assert.match(html,/rel="canonical" href="https:\/\/getloynara\.com\//);assert.doesNotMatch(html,/LoopLocal|looplocal\.|localhost|preview\.getloynara\.com|card_[A-Za-z0-9_-]{10,}|password/i);
 for(const [,url]of html.matchAll(/(?:src|href)="([^"]+)"/g)){if(/^(https:|mailto:)/.test(url))continue;const [path,hash]=url.split('#');let target=path?resolve(root,'.'+path):page;if(existsSync(target)&&statSync(target).isDirectory())target=resolve(target,'index.html');assert.ok(existsSync(target),`Missing link ${url} in ${page}`);if(hash){const linked=readFileSync(target,'utf8');assert.ok(linked.includes(`id="${hash}"`),`Missing anchor ${url}`);}}
}
for(const file of walk(resolve(root,'assets/modules'))){const js=readFileSync(file,'utf8');assert.doesNotMatch(js,/fetch\(|sendBeacon|localStorage|sessionStorage|document\.cookie|console\.log|https?:\/\//,`${file}: no outbound/data persistence API`);for(const [,p]of js.matchAll(/from ['"](.+?)['"]/g))assert.ok(existsSync(resolve(dirname(file),p)));}
const headers=readFileSync(resolve(root,'_headers'),'utf8');assert.match(headers,/script-src 'self'/);assert.match(headers,/connect-src 'none'/);assert.match(headers,/form-action 'none'/);assert.doesNotMatch(headers,/unsafe-inline|unsafe-eval/);
console.log(`PASS: ${pages.length} pages, metadata, assets, internal links, JS imports, private-output and browser data-flow checks.`);
