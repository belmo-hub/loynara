import {readFileSync} from 'node:fs';
import {expect,test} from '@playwright/test';
import {pool} from '../src/db';
const fixture=JSON.parse(readFileSync('/tmp/loy-103-browser-fixture.json','utf8')) as {cards:{id:string;cardToken:string}[]};
const database=new URL(process.env.DATABASE_URL??'http://invalid');
if(database.hostname!=='localhost'||database.port!=='55433'||database.pathname!=='/looplocal_browser_wallet_103')throw new Error('Owned Wallet browser database required');
test.afterAll(async()=>{await pool.end();});
for(const [index,leave,failure] of [[0,false,false],[1,true,false],[2,true,true]] as const)test(`obsolete Google acknowledgment is ignored after ${leave?'unmount':'closure'} (${failure?'failure':'success'})`,async({browser,baseURL})=>{
 if(baseURL!=='http://localhost:3000')throw new Error('Loopback app required');
 const member=fixture.cards[index],context=await browser.newContext({baseURL,viewport:{width:390,height:844}}),navigation:string[]=[];let navigationStarted!:()=>void;const navigated=new Promise<void>(r=>{navigationStarted=r;});
 let release!:()=>void,ready!:()=>void;
 const held=new Promise<void>(r=>{release=r;}),acknowledged=new Promise<void>(r=>{ready=r;});
 try{
  await context.route('https://pay.google.com/**',async route=>{navigation.push(new URL(route.request().url()).origin);navigationStarted();await route.abort();});
  await context.addInitScript(()=>{
   const original=window.fetch;const mark=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{(window as Window&{walletSettled?:boolean}).walletSettled=true;}));
   window.fetch=async(...args)=>{
    const tracked=String(args[0])==='/api/wallet/google';
    try{const response=await original(...args);if(tracked){const json=response.json.bind(response);response.json=async()=>{try{return await json();}finally{mark();}};}return response;}
    catch(error){if(tracked)mark();throw error;}
   };
  });
  const page=await context.newPage();
  await page.route('**/api/wallet/google',async route=>{
   const response=await route.fetch();expect(response.status()).toBe(200);expect((await response.json()).url).toMatch(/^https:\/\/pay.google.com\/gp\/v\/save\//);ready();await held;
   try{await route.fulfill(failure?{status:502,json:{code:'WALLET_PROVIDER_ERROR',error:'Synthetic provider unavailable'}}:{response});}catch(error){if(!page.isClosed()&&!String(error).includes('closed'))throw error;}
  });
  await page.goto('/card/'+encodeURIComponent(member.cardToken));await expect(page.getByRole('button',{name:'Zu Google Wallet hinzufügen',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Zu Google Wallet hinzufügen',exact:true}).click();await acknowledged;
  await page.getByRole('button',{name:'Karte schließen',exact:true}).click();await page.getByRole('button',{name:'Schließung verbindlich bestätigen',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Karte geschlossen.',exact:true})).toBeVisible();
  if(leave){await page.getByRole('link',{name:'Datenschutz',exact:true}).click();await expect(page).toHaveURL(baseURL+'/datenschutz');}
  release();await Promise.race([navigated,page.waitForFunction(()=>(window as Window&{walletSettled?:boolean}).walletSettled===true)]);
  expect(navigation).toEqual([]);
  if(!leave)await expect(page.getByRole('heading',{name:'Karte geschlossen.',exact:true})).toBeVisible();else await expect(page).toHaveURL(baseURL+'/datenschutz');
  expect((await pool.query('SELECT closed_at IS NOT NULL AS closed FROM memberships WHERE id=$1',[member.id])).rows).toEqual([{closed:true}]);
  expect((await pool.query('SELECT revoked_at IS NOT NULL AS revoked FROM wallet_passes WHERE membership_id=$1',[member.id])).rows).toEqual([{revoked:true}]);
 }finally{release();await context.close();}
});

test('current Google issuance recovers from an unconfirmed response with the same projection',async({browser,baseURL})=>{
 const member=fixture.cards[3],context=await browser.newContext({baseURL,viewport:{width:390,height:844}});let attempts=0;let navigated!:()=>void;const saved=new Promise<void>(r=>{navigated=r;});
 try{
  await context.route('https://pay.google.com/**',async route=>{navigated();await route.fulfill({status:200,contentType:'text/html',body:'<h1>Synthetic Google save destination</h1>'});});
  const page=await context.newPage();await page.route('**/api/wallet/google',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);attempts++;await route.fulfill(attempts===1?{status:502,json:{code:'WALLET_PROVIDER_ERROR',error:'Synthetic unavailable'}}:{response});});
  await page.goto('/card/'+encodeURIComponent(member.cardToken));await page.getByRole('button',{name:'Zu Google Wallet hinzufügen',exact:true}).click();
  await expect(page.getByText('Wallet ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten erneut; deine Karte funktioniert weiterhin hier.',{exact:true})).toBeVisible();
  const before=(await pool.query('SELECT id,provider_object_id FROM wallet_passes WHERE membership_id=$1',[member.id])).rows;expect(before).toHaveLength(1);
  await expect(page.getByRole('button',{name:'Zu Google Wallet hinzufügen',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Zu Google Wallet hinzufügen',exact:true}).click();await saved;
  expect(attempts).toBe(2);expect((await pool.query('SELECT id,provider_object_id FROM wallet_passes WHERE membership_id=$1',[member.id])).rows).toEqual(before);
  expect((await pool.query('SELECT balance,closed_at FROM memberships WHERE id=$1',[member.id])).rows).toEqual([{balance:0,closed_at:null}]);
 }finally{await context.close();}
});
