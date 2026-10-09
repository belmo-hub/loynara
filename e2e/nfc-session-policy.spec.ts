import { createHmac, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { MASTER, merchantWithTag, pathOf, resetPeerLimits, pendingOf, sql } from "./nfc-support";
test.skip(!MASTER,"Isolated synthetic NFC server required");
test.beforeEach(resetPeerLimits);
test("customer browser renews a fresh visit within its immutable root; cashier and refresh do not renew; both expiry bounds require proof",async({browser,baseURL})=>{
 const m=await merchantWithTag(baseURL!), customer=await browser.newContext({baseURL});
 const origin={Origin:new URL(baseURL!).origin};
 try{
  const enrolled=await customer.request.post("/api/enroll",{headers:origin,data:{slug:m.me.programSlug,acceptedTerms:true}});expect(enrolled.status()).toBe(201);
  const {cardToken}=await enrolled.json(), state=await customer.storageState();
  const now=Math.floor(Date.now()/1000), root=now-350*86400;
  const credential=(issued:number,lastActivity:number)=>{const payload=Buffer.from(JSON.stringify({token:cardToken,issued,lastActivity,shared:false,nonce:randomBytes(16).toString("base64url")})).toString("base64url");const signature=createHmac("sha256",process.env.BETTER_AUTH_SECRET!).update("loynara-customer-session-v2\0").update(m.me.programId).update("\0").update(payload).digest("base64url");return `v2.${payload}.${signature}`;};
  const inject=async(value:string)=>customer.addCookies(state.cookies.filter(c=>c.name.startsWith("loynara_")).map(c=>({...c,value,expires:now+90*86400})));
  await inject(credential(root,now-85*86400));
  const page=await customer.newPage();await page.goto(pathOf(m.nextUrl()));await expect(page.getByRole("heading",{name:"Warte auf das Team"})).toBeVisible();
  const renewed=(await customer.cookies()).filter(c=>c.name.startsWith("loynara_"));
  expect(renewed.filter(c=>c.name.startsWith("loynara_member_"))).toHaveLength(1);
  for(const c of renewed){const payload=JSON.parse(Buffer.from(c.value.split(".")[1],"base64url").toString());expect(payload.issued).toBe(root);expect(payload.lastActivity).toBeGreaterThan(now-60);expect(c.expires).toBeLessThanOrEqual(root+365*86400+2);}
  const before=renewed.map(c=>c.value).sort();await page.reload();await expect(page.getByRole("heading",{name:"Warte auf das Team"})).toBeVisible();
  expect((await customer.cookies()).filter(c=>c.name.startsWith("loynara_")).map(c=>c.value).sort()).toEqual(before);
  const pending=await pendingOf(m.cashier);expect(pending).toHaveLength(1);
  const approval=await m.cashier.post(`/api/cashier/tap/${pending[0].id}/confirm`);expect(approval.status()).toBe(200);expect(approval.headers()["set-cookie"]).toBeUndefined();
  await expect(page.getByText("Aktueller Stand: 1 Stempel")).toBeVisible();
  expect((await customer.cookies()).filter(c=>c.name.startsWith("loynara_")).map(c=>c.value).sort()).toEqual(before);
  for(const expired of [credential(now-100*86400,now-90*86400),credential(now-365*86400,now)]){
   await inject(expired);await page.goto(pathOf(m.nextUrl()));await expect(page.getByRole("heading",{name:"Deine Karte wiederfinden"})).toBeVisible();expect(await pendingOf(m.cashier)).toHaveLength(0);
   await page.goto(`/card/${cardToken}`);await expect(page.getByRole("button",{name:"Diese Karte für NFC verwenden"})).toBeVisible();
   expect((await customer.cookies()).filter(c=>c.name.startsWith("loynara_")).every(c=>c.value===expired)).toBe(true);
  }
  expect((await sql("SELECT count(*)::int AS n, max(balance)::int AS balance FROM memberships WHERE program_id=$1",[m.me.programId]))[0]).toEqual({n:1,balance:1});
 }finally{await customer.close();await m.close();}
});
