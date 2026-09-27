import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import QRCode from 'qrcode';
import {page} from './template.js';
import {industries,type IndustryKey} from './src/config.js';
const root=resolve(import.meta.dirname,'site');
if(process.env.MARKETING_PUBLIC==='true')throw new Error('Public activation blocked: approved operator legal pages, contact destination and final commercial terms are required.');
await mkdir(resolve(root,'assets/modules'),{recursive:true});
const routes=['','demo',...Object.keys(industries)];
for(const route of routes){await mkdir(resolve(root,route),{recursive:true});await writeFile(resolve(root,route,'index.html'),page(route in industries?route as IndustryKey:'cafe',route));}
await writeFile(resolve(root,'assets/demo-code.svg'),await QRCode.toString('LOY NARA DEMO - KEINE ECHTE KUNDENKARTE',{type:'svg',margin:1,color:{dark:'#163e35',light:'#ffffff'}}));
await copyFile(resolve(import.meta.dirname,'styles.css'),resolve(root,'styles.css'));
await writeFile(resolve(root,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(r=>`<url><loc>https://getloynara.com/${r?r+'/':''}</loc></url>`).join('')}</urlset>`);
await mkdir(resolve(root,'demo-transcript'),{recursive:true});
await writeFile(resolve(root,'demo-transcript/index.html'),`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Produktdemo – Textfassung | Loynara</title><link rel="canonical" href="https://getloynara.com/demo-transcript/"><link rel="stylesheet" href="/styles.css"></head><body><main class="wrap section"><a class="button secondary" href="/demo/#plattform">Zur Produktdemo</a><h1>Die Aufzeichnung.<br><em>Schritt für Schritt.</em></h1><p>Lokale Anwendung, synthetische Daten, Kamera simuliert, keine Tonspur.</p><ol class="transcript"><li>Inhaberübersicht: zwei synthetische Karten und bestätigte Aktivität.</li><li>Programm: fünf Stempel für einen Kaffee, weitere Prämie mit eigenen Kosten.</li><li>Beitritt: Regeln ansehen und neue Browserkarte öffnen.</li><li>Karte wieder öffnen: privater Link, zunächst null Stempel.</li><li>Kasse: QR-Erkennung mit simulierter Kamera. Zuerst einen Stempel, später ausdrücklich vier weitere bestätigen.</li><li>Prämie auswählen und Einlösung bestätigen. Stand: fünf auf null.</li><li>Kundenkarte: aktualisierter Stand und Aktivität.</li><li>Inhaberübersicht: bestätigte Buchungen sichtbar.</li><li>Aktivität und Zielgruppe: aktive Karten von eins auf zwei.</li><li>Kampagne: Zielgruppe, Vorschau und geplante Nachricht.</li><li>Mailpit: eine lokale Nachricht an einen synthetischen, verifizierten und eingewilligten Kontakt. Kein externer Versand.</li><li>Empfehlung: bestätigtes qualifizierendes Ereignis im Bericht.</li><li>Team und Standorte: zugeordnete Rollen und getrennte Programme.</li><li>Offline-Vergabe: vorgemerkt, erst nach Serverannahme ein Stempel.</li><li>Planstatus: gespeicherter Entwurf, keine Zahlung.</li></ol><p>Die interaktive Demo nutzt bewusst eine eigene 8-Stempel-Regel. Beide Vorführungen sind Beispiele, keine Umsatznachweise.</p></main></body></html>`);
const result=spawnSync(resolve('node_modules/.bin/tsc'),['-p','marketing-site/tsconfig.json'],{stdio:'inherit'});if(result.status)process.exit(result.status);
console.log(`Marketing build PASS: ${routes.length+1} static pages, no application/database dependency. Publication remains gated.`);
