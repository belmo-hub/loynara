import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const base='http://127.0.0.1:8765',out='marketing-site/evidence/languages';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[],external=[];
const pass=name=>{results.push({name,result:'PASS'});console.log(`PASS ${name}`)};
const german=/Kundensicht|Kassensicht|Inhaberansicht|Stempel|Prämie|Preisvorschlag|Bitte einen|Einlösung|Zusätzlicher|Geschäftsname|Kundenbindung/;
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url())});
 async function capture(selector,path){await p.locator('.header').evaluate(e=>{e.style.visibility='hidden'});try{await p.locator(selector).screenshot({path,animations:'disabled'});}finally{await p.locator('.header').evaluate(e=>e.style.removeProperty('visibility'));}}
 for(const locale of ['en','ar']){
  const url=`${base}/${locale}/`;
  await p.goto(url);await p.waitForFunction(()=>!document.querySelector('#demo-next').disabled);
  assert.equal(await p.locator('html').getAttribute('lang'),locale);assert.equal(await p.locator('html').getAttribute('dir'),locale==='ar'?'rtl':'ltr');
  assert.doesNotMatch(await p.locator('body').innerText(),german);
  assert.equal(await p.locator('.language-switch a[aria-current=page]').getAttribute('hreflang'),locale);
  await p.locator('#contribution').fill(locale==='ar'?'٨':'8');assert.equal(await p.locator('#required').innerText(),'7');
  await p.locator('#calc-details summary').click();await p.locator('#rewards').fill(locale==='ar'?'٢٠':'20');await p.locator('#effort').fill(locale==='ar'?'١٠':'10');await p.locator('#visits').fill(locale==='ar'?'١٠':'10');assert.equal(await p.locator('#required').innerText(),'10');assert.match(await p.locator('#scenario-change').innerText(),/1\.00/);
  await p.locator('#contribution').fill('0');assert.equal(await p.locator('#required').innerText(),'–');assert.doesNotMatch(await p.locator('#result-explanation').innerText(),german);
  await p.locator('#contribution').fill(locale==='ar'?'٨٫٥٠':'8.50');assert.equal(await p.locator('#required').innerText(),'10');
  await p.locator('#rewards').fill('-2');assert.ok((await p.locator('#calc-error').innerText()).length>15);assert.doesNotMatch(await p.locator('#calc-error').innerText(),german);await p.locator('#load-example').click();
  await p.locator('#traffic-basket').fill(locale==='ar'?'٧٠٫٥٠':'70.50');assert.match(await p.locator('#traffic-monthly-revenue').innerText(),/9,165\.00/);assert.equal(await p.locator('#traffic-basket-range').inputValue(),'70.5');
  await p.locator('#traffic-uplift').fill(locale==='ar'?'٠':'0');assert.match(await p.locator('#traffic-after-fee').innerText(),/49\.00/);await p.locator('#traffic-sample').click();
  await p.locator('[data-traffic-price=standard]').click();assert.equal(await p.locator('[data-price=standard]').getAttribute('aria-pressed'),'true');await p.locator('[data-traffic-price=founding]').click();
  pass(`${locale}: locale-aware calculators, Arabic/Latin input, validation and pricing synchronization`);
  for(const key of ['barber','friseur','nagelstudio','gastro','autopflege','wellness','fitness','cafe']){await p.locator(`[data-industry-choice=${key}]`).click();assert.doesNotMatch(await p.locator('#industry-intro').innerText(),german);}
  await p.locator('#business-name').fill(locale==='ar'?'مقهى نور Café 42':'North Café');assert.match(await p.locator('#industry-preview-name').innerText(),locale==='ar'?/مقهى نور/:/North Café/);
  await p.locator('#demo-next').click();await p.locator('[data-action=enroll]').click();await p.locator('#demo-next').click();await p.locator('#demo-next').click();await p.locator('[data-action=identify]').click();assert.equal((await p.locator('[data-cashier-balance]').innerText()).match(/\d+/)[0],'0');await p.locator('[data-action=award]').click();assert.equal((await p.locator('[data-cashier-balance]').innerText()).match(/\d+/)[0],'1');await p.locator('#demo-next').click();await p.locator('[data-view=owner]').click();assert.equal(await p.locator('.owner-metrics strong').first().innerText(),'1');await p.locator('[data-action=jump]').click();await p.locator('[data-action=last]').click();await p.locator('[data-action=redeem]').click();assert.equal(await p.locator('.owner-metrics strong').nth(2).innerText(),'0');assert.doesNotMatch(await p.locator('.demo-shell').innerText(),german);await capture('.owner-screen',`${out}/${locale}-owner-redemption.png`);await p.locator('#reset-demo').click();
  for(const [key,count] of [['referral',3],['return',4]]){await p.locator(`#${key}-story summary`).click();for(let i=0;i<count;i++){await p.locator(`[data-story-next=${key}]`).click();assert.doesNotMatch(await p.locator(`#${key}-flow`).innerText(),german);}await p.locator(`[data-story-reset=${key}]`).click();}
  for(const key of ['activity','offers','growth','programme']){await p.locator(`[data-feature=${key}]`).click();await p.waitForFunction(()=>!document.querySelector('.product-capture').hasAttribute('aria-busy'));assert.doesNotMatch(await p.locator('#feature-detail').innerText(),german);}
  const download=p.waitForEvent('download');await p.locator('#download-brief').click();assert.match((await download).suggestedFilename(),locale==='ar'?/ملاحظات-المحادثة\.txt$/:/conversation-note\.txt$/);
  pass(`${locale}: all industries, localized checkout/redemption, referral/campaign story, feature tabs and local note download`);
  for(const route of ['','cafe/','barber/','friseur/','nagelstudio/','gastro/','autopflege/','fitness/','wellness/','demo/','demo-transcript/']){assert.equal((await p.goto(url+route)).status(),200);assert.equal(await p.locator('html').getAttribute('lang'),locale);assert.doesNotMatch(await p.locator('body').innerText(),german);}
  await p.goto(`${url}barber/`);await p.locator(`.language-switch a[hreflang="${locale==='en'?'ar':'en'}"]`).click();assert.ok(p.url().endsWith(`/${locale==='en'?'ar':'en'}/barber/`));
  pass(`${locale}: eleven routes and language switch preserve the current industry page`);
  for(const size of [{width:360,height:800},{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}]){
   await p.setViewportSize(size);await p.emulateMedia({reducedMotion:'reduce'});await p.goto(url);await p.waitForFunction(()=>!document.querySelector('#demo-next').disabled);await p.evaluate(()=>document.fonts.ready);
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow ${locale}/${size.width}`);
   const nav=await p.locator('.language-switch a').evaluateAll(es=>es.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,x:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})));assert.ok(nav.every(e=>e.h>=44&&e.x>=0&&e.right<=size.width));assert.ok(await p.locator('.header').evaluate(e=>e.getBoundingClientRect().height<115),'Language controls must remain in a compact header row');
   await p.screenshot({path:`${out}/${locale}-hero-${size.width}.png`,animations:'disabled'});
   if(size.width===390||size.width===1440){for(const id of ['geschaeft','ablauf','rechner','preise'])await capture('#'+id,`${out}/${locale}-${id}-${size.width}.png`);}
   if(size.width===390){await p.locator('#menu-toggle').click();assert.equal(await p.locator('#main-nav').isVisible(),true);await p.locator('#main-nav a[href="#rechner"]').click();assert.equal(await p.locator('#main-nav').isVisible(),false);await p.locator('#contribution').fill(locale==='ar'?'٨':'8');assert.equal(await p.locator('#required').innerText(),'7');await p.locator('#demo-next').focus();await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('data-action')),'enroll');await p.keyboard.press('Enter');await p.locator('#demo-next').click();await p.locator('#demo-next').click();assert.equal(await p.locator('.cashier-screen').isVisible(),true);}
  }
  pass(`${locale}: five responsive sizes, legible touch controls, mobile menu, keyboard and reduced motion`);
  await p.setViewportSize({width:720,height:450});await p.goto(url);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const plainContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),plain=await plainContext.newPage();await plain.goto(url);assert.equal(await plain.locator('html').getAttribute('lang'),locale);assert.doesNotMatch(await plain.locator('body').innerText(),german);await plain.locator('.language-switch a[hreflang=de]').click();assert.equal(new URL(plain.url()).pathname,'/');await plainContext.close();
  pass(`${locale}: 200%-equivalent reflow and translated static content/navigation without JavaScript`);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('No application errors or external requests');
 const hash=createHash('sha256');for(const file of ['en/index.html','ar/index.html','styles.css',...['browser','config','views','economics','i18n','dynamic-copy'].map(n=>`assets/modules/${n}.js`)])hash.update(await readFile(`marketing-site/site/${file}`));
 await writeFile('marketing-site/locale-browser-evidence.json',JSON.stringify({sourceHash:hash.digest('hex'),conditions:'Local Chromium browser emulation; no physical phone or native-language human review. Screenshots use reduced motion, section captures hide sticky navigation to avoid capture overlap.',checks:results},null,2)+'\n');
}finally{await browser.close();}
