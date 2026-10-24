import {readFileSync,mkdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import pg from "pg";
import {expect,request as apiRequest,test} from "@playwright/test";

// Only a pre-provisioned synthetic loopback fixture. Public registration stays closed on the tested server.
const enabled=process.env.E2E_OVERNIGHT_SAFE === "1";
test.skip(!enabled,"Requires the isolated production-like safe server and local synthetic fixture");
type Access={ownerEmail:string;ownerPassword:string;cashierEmail:string;cashierPassword:string;managerEmail:string;managerPassword:string;programSlug:string;programId:string;locationId:string;tenantId:string;secondLocationId:string;foreignSlug:string;foreignLocationId:string;referrerToken:string};
function fixture():Access{
 const db=new URL(process.env.DATABASE_URL!);
 if(!["localhost","127.0.0.1"].includes(db.hostname)||db.port!=="54329"||db.pathname!=="/looplocal")throw Error("Review browser tests require isolated loopback DB");
 return JSON.parse(readFileSync(resolve("var/review-access.json"),"utf8"));
}
async function signIn(baseURL:string,email:string,password:string,peer:string){
 if(!["localhost","127.0.0.1"].includes(new URL(baseURL).hostname))throw Error("Review browser tests require loopback server");
 const api=await apiRequest.newContext({baseURL,extraHTTPHeaders:{Origin:new URL(baseURL).origin,"cf-connecting-ip":peer}});
 expect((await api.post("/api/auth/sign-in/email",{data:{email,password}})).status()).toBe(200);
 return api;
}

for(const width of [1440,390])test(`safe production configuration owner, cashier and manager at ${width}`,async({baseURL,browser})=>{
 const f=fixture(),url=baseURL!;
 const owner=await signIn(url,f.ownerEmail,f.ownerPassword,"203.0.113.71");
 const manager=await signIn(url,f.managerEmail,f.managerPassword,"203.0.113.72");
 const cashier=await signIn(url,f.cashierEmail,f.cashierPassword,"203.0.113.73");
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const context=await browser.newContext({baseURL:url,viewport:{width,height:1000},storageState:await owner.storageState(),extraHTTPHeaders:{"cf-connecting-ip":"203.0.113.71"}});
 try{
  const me=await(await owner.get("/api/me")).json();
  expect(me.hiddenSurfaces).toEqual(expect.arrayContaining(["automations","billing","campaigns","nfc","walletPreviews"]));
  expect(me.hiddenSurfaces).not.toContain("audiences");expect(me.tapAutomaticAllowed).toBe(false);
  const registration=await owner.post("/api/auth/sign-up/email",{data:{name:"Must refuse",email:`refused-${randomUUID()}@example.test`,password:`Local!${randomUUID()}Aa`}});
  expect(registration.status()).toBe(403);
  const page=await context.newPage();
  mkdirSync("var/qa/overnight-independent",{recursive:true});
  for(const [path,heading] of [["/merchant","Übersicht"],["/merchant/customers","Kundenkarten"],["/merchant/analytics","Ergebnisse"],["/merchant/referrals","Empfehlungen"],["/merchant/staff","Das Team am Tresen."],["/merchant/audiences","Segmente prüfen"]]){
   await page.goto(path);await expect(page.getByRole("heading",{name:heading,exact:true,level:1})).toBeVisible();
   await expect(page.locator(".ow-skel")).toHaveCount(0);
   if(path==="/merchant")await expect(page.getByRole("heading",{name:"Was jetzt zählt"})).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
   await page.screenshot({path:`var/qa/overnight-independent/${width}-${path.split("/").pop()||"overview"}.png`,fullPage:true});
  }
  for(const path of ["/merchant/campaigns","/merchant/automations","/merchant/billing"]){await page.goto(path);await expect(page.getByRole("heading",{name:"Diese Seite gibt es nicht."})).toBeVisible();}
  await page.goto("/merchant/program");await expect(page.getByText("NFC-Tap (optional)")).toHaveCount(0);
  const policy=await owner.post("/api/merchant/tap",{data:{action:"policy",programId:f.programId,mode:"automatic_fixed",cooldownSeconds:60}});expect(policy.status()).toBe(400);expect((await policy.json()).code).toBe("TAP_AUTOMATIC_NOT_ALLOWED");
  // Even a stored staff-confirmed policy cannot display a disabled-capability panel.
  expect((await owner.post("/api/merchant/tap",{data:{action:"policy",programId:f.programId,mode:"staff_confirmed",cooldownSeconds:60}})).status()).toBe(200);
  const counter=await browser.newContext({baseURL:url,viewport:{width,height:1000},storageState:await cashier.storageState(),extraHTTPHeaders:{"cf-connecting-ip":"203.0.113.73"}});
  try{const till=await counter.newPage();await till.goto("/cashier");await expect(till.getByRole("heading",{name:/Karte scannen/})).toBeVisible();await expect(till.getByRole("heading",{name:"NFC-Anfragen"})).toHaveCount(0);await till.screenshot({path:`var/qa/overnight-independent/${width}-cashier.png`,fullPage:true});}finally{await counter.close();}
  expect((await owner.post("/api/merchant/tap",{data:{action:"policy",programId:f.programId,mode:"disabled",cooldownSeconds:null}})).status()).toBe(200);
  const managerContext=await browser.newContext({baseURL:url,viewport:{width,height:1000},storageState:await manager.storageState(),extraHTTPHeaders:{"cf-connecting-ip":"203.0.113.72"}});
  try{const scoped=await managerContext.newPage();await scoped.goto("/merchant/audiences");await expect(scoped.getByRole("heading",{name:"Segmente prüfen"})).toBeVisible();await expect(scoped.getByRole("link",{name:/Kampagne/})).toHaveCount(0);await scoped.screenshot({path:`var/qa/overnight-independent/${width}-manager-audiences.png`,fullPage:true});}finally{await managerContext.close();}
  expect((await manager.get(`/api/merchant/retention?locationId=${f.secondLocationId}`)).status()).toBe(404);
  expect((await owner.get(`/api/merchant/retention?locationId=${f.foreignLocationId}`)).status()).toBe(404);
  const m=await(await manager.get("/api/merchant/retention")).json();expect(m.locationId).toBe(f.locationId);
  for(const days of [14,30,60,90]){const summaryResponse=await owner.get(`/api/merchant/retention?days=${days}&locationId=${f.locationId}`);expect(summaryResponse.status()).toBe(200);const summary=await summaryResponse.json();const listResponse=await owner.get(`/api/merchant/customers?activity=drifting&days=${days}&locationId=${f.locationId}`);expect(listResponse.status()).toBe(200);const list=await listResponse.json();expect(summary.drifting).toBe(list.members.length);}
  await page.goto("/merchant/customers?activity=drifting&days=30&scope=all");
  await expect(page.getByText("Warum diese Karten?")).toBeVisible();
  await expect(page.getByLabel("Ansicht")).toHaveValue("drifting");
  await expect(page.getByRole("link",{name:"Rückhol-Aktion vorbereiten"})).toHaveCount(0);
  const filteredCard=(await(await owner.get(`/api/merchant/customers?activity=drifting&days=30&locationId=${f.locationId}`)).json()).members[0].cardLocator;
  await page.goto(`/merchant/customers?activity=drifting&days=30&locationId=${f.locationId}&q=${encodeURIComponent(filteredCard)}`);
  await expect(page.getByText("Warum diese Karten?")).toBeVisible();await expect(page.getByRole("link",{name:"Rückhol-Aktion vorbereiten"})).toHaveCount(0);
  const progress=await(await owner.get(`/api/card/${f.referrerToken}/referral`)).json();expect(JSON.stringify(progress)).not.toContain("@example.test");
  await page.goto("/merchant");await expect(page.getByRole("link",{name:"Rückhol-Aktion vorbereiten"})).toHaveCount(0); // Product, 24 Oct: no e-mail campaign is offered while e-mail is off
  await context.addInitScript(()=>{
   const state=window as unknown as {reviewShares:ShareData[];reviewCopies:string[];reviewAbort:boolean};state.reviewShares=[];state.reviewCopies=[];state.reviewAbort=false;
   Object.defineProperty(navigator,"share",{configurable:true,value:async(data:ShareData)=>{state.reviewShares.push(data);if(state.reviewAbort)throw new DOMException("Cancelled","AbortError");}});
   Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(value:string)=>{state.reviewCopies.push(value);}}});
  });
  await page.goto(`/card/${f.referrerToken}`);await expect(page.getByRole("button",{name:"Teilen",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Teilen",exact:true}).click();
  const shared=await page.evaluate(()=>(window as unknown as {reviewShares:ShareData[]}).reviewShares);expect(shared[0].url).toBe(progress.shareUrl);expect(shared[0].url).not.toContain(f.referrerToken);
  await page.evaluate(()=>(window as unknown as {reviewAbort:boolean}).reviewAbort=true);await page.getByRole("button",{name:"Teilen",exact:true}).click();
  expect(await page.evaluate(()=>(window as unknown as {reviewCopies:string[]}).reviewCopies)).toEqual([]);
  await page.getByRole("button",{name:"Link kopieren",exact:true}).click();expect(await page.evaluate(()=>(window as unknown as {reviewCopies:string[]}).reviewCopies)).toEqual([progress.shareUrl]);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`var/qa/overnight-independent/${width}-customer-referral.png`,fullPage:true});
 }finally{await context.close();await client.end();await owner.dispose();await manager.dispose();await cashier.dispose();}
});
