import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import QRCode from 'qrcode';
import {page} from './template.js';
import {industries,type IndustryKey} from './src/config.js';
import {locales,localePath} from './src/i18n.js';
import {transcript} from './transcript.js';
const root=resolve(import.meta.dirname,'site');
if(process.env.MARKETING_PUBLIC==='true')throw new Error('Public activation blocked: approved operator legal pages, contact destination and final commercial terms are required.');
await mkdir(resolve(root,'assets/modules'),{recursive:true});
const routes=['','demo',...Object.keys(industries)];
for(const locale of locales){
 for(const route of routes){const dir=resolve(root,'.'+localePath(locale,route?`/${route}/`:'/'));await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'index.html'),page(route in industries?route as IndustryKey:'cafe',route,locale));}
 const dir=resolve(root,'.'+localePath(locale,'/demo-transcript/'));await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'index.html'),transcript(locale));
}
await writeFile(resolve(root,'assets/demo-code.svg'),await QRCode.toString('LOY NARA DEMO - KEINE ECHTE KUNDENKARTE',{type:'svg',margin:1,color:{dark:'#163e35',light:'#ffffff'}}));
await copyFile(resolve(import.meta.dirname,'styles.css'),resolve(root,'styles.css'));
await writeFile(resolve(root,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locales.flatMap(locale=>[...routes,'demo-transcript'].map(r=>`<url><loc>https://getloynara.com${localePath(locale,r?`/${r}/`:'/')}</loc></url>`)).join('')}</urlset>`);
const result=spawnSync(resolve('node_modules/.bin/tsc'),['-p','marketing-site/tsconfig.json'],{stdio:'inherit'});if(result.status)process.exit(result.status);
console.log(`Marketing build PASS: ${(routes.length+1)*locales.length} static pages in three languages, no application/database dependency. Publication remains gated.`);
