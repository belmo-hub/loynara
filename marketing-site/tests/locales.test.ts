import test from 'node:test';
import assert from 'node:assert/strict';
import {page} from '../template.js';
import {parseMoney} from '../src/economics.js';
import {localePath} from '../src/i18n.js';
import {getIndustries,getOffers,type IndustryKey} from '../src/config.js';
import {demoScreens} from '../src/views.js';
import {initialDemo} from '../src/demo.js';

test('English and Arabic pages are translated before JavaScript runs',()=>{
 const render=page as (key:'cafe',route:string,locale:'en'|'ar')=>string;
 const english=render('cafe','cafe','en'),arabic=render('cafe','cafe','ar');
 assert.ok(english.includes('<html lang="en" dir="ltr">'),'English SSR language');
 assert.ok(arabic.includes('<html lang="ar" dir="rtl">'),'Arabic SSR language and direction');
 for(const [html,locale] of [[english,'en'],[arabic,'ar']]){
  assert.ok(html.includes(`https://getloynara.com/${locale}/cafe/`));
  assert.ok(html.includes('hreflang="de"'));
  assert.ok(html.includes('hreflang="en"'));
  assert.ok(html.includes('hreflang="ar"'));
  assert.doesNotMatch(html,/Mach aus Kunden|Kundensicht|Kassensicht|Inhaberansicht|Was zahle ich genau|Preisvorschläge pro Standort/);
 }
});

test('Each language accepts local monetary input without changing cents',()=>{
 const parse=parseMoney as (value:string,locale:'de'|'en'|'ar')=>number|null;
 assert.equal(parse('8,50','de'),850);
 assert.equal(parse('8.50','en'),850);
 assert.equal(parse('1,234.50','en'),123450);
 assert.equal(parse('٨٫٥٠','ar'),850);
 assert.equal(parse('١٬٢٣٤٫٥٠','ar'),123450);
 assert.equal(parse('','ar'),null);
 assert.equal(parse('-٨٫٥٠','ar'),-850);
 assert.throws(()=>parse('8.999','en'));
});

test('Local routes switch language without losing the page or translating assets',()=>{
 assert.equal(localePath('ar','/en/barber/'),'/ar/barber/');
 assert.equal(localePath('de','/ar/demo/'),'/demo/');
 assert.equal(localePath('en','/'),'/en/');
 assert.equal(localePath('ar','#rechner'),'#rechner');
 assert.equal(localePath('en','/assets/demo-code.svg'),'/assets/demo-code.svg');
});

test('Translations preserve programme thresholds, money and escaped business names',()=>{
 const source=getIndustries('de'),offers=getOffers('de');
 for(const locale of ['en','ar'] as const){
  for(const [key,industry] of Object.entries(getIndustries(locale))){
   assert.equal(industry.threshold,source[key as IndustryKey].threshold);
   const html=demoScreens(initialDemo(industry.threshold),key as IndustryKey,'<img src=x onerror=alert(1)>',locale);
   assert.ok(!/<img src=x/.test(html));
   assert.ok(!/Kundensicht|Kassensicht|Inhaberansicht|Stempel|Prämie/.test(html));
  }
  const translated=getOffers(locale);
  for(const key of ['founding','standard','introDraft'] as const){
   assert.equal(translated[key].initial,offers[key].initial);
   assert.equal(translated[key].monthly,offers[key].monthly);
   assert.equal(translated[key].draft,offers[key].draft);
  }
 }
});
