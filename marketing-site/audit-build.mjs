import {cp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const source=resolve('marketing-site/site');
const destination=resolve('var/loynara-audit-ready');
await mkdir(destination,{recursive:true});
await cp(source,destination,{recursive:true});
async function walk(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);result.push(...(e.isDirectory()?await walk(p):[p]));}return result;}
const files=await walk(destination);
for(const file of files){if(!/\.(html|xml|txt)$/.test(file))continue;let text=await readFile(file,'utf8');text=text.replaceAll('https://getloynara.com','https://loynara-audit.pages.dev');if(file.endsWith('.html')){const language=/<html lang="(de|en|ar)"/.exec(text)?.[1]||'de';const notice={de:'Loynara · öffentliche Audit-Vorschau · Beispieldaten · kein kommerzielles Angebot',en:'Loynara · public audit preview · sample data · not a commercial offer',ar:'Loynara · معاينة عامة للمراجعة · بيانات تجريبية · ليست عرضاً تجارياً'}[language];const label={de:'Audit-Status',en:'Audit status',ar:'حالة المعاينة'}[language];text=text.replace('<head>','<head><meta name="robots" content="noindex, nofollow, noarchive">').replace(/(<body[^>]*>)/,`$1<aside class="audit-notice" aria-label="${label}">${notice}</aside>`);assert(!text.includes('preview.getloynara.com'));}await writeFile(file,text);}
await writeFile(resolve(destination,'_headers'),(await readFile(resolve(source,'_headers'),'utf8'))+'\n  X-Robots-Tag: noindex, nofollow, noarchive\n');
await writeFile(resolve(destination,'robots.txt'),'User-agent: *\nAllow: /\n');
console.log(`Audit bundle ready: ${files.length} static files in var/loynara-audit-ready. No publication performed.`);
