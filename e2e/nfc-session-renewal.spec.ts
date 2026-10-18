import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { MASTER, merchantWithTag, pathOf, resetPeerLimits, pendingOf, customerCardNumber, sql } from "./nfc-support";
test.skip(!MASTER,"Explicit isolated NFC server required");test.beforeEach(resetPeerLimits);
test("customer browser receives activity renewal before cashier approval; reload/card refresh preserve the original cap",async({browser,baseURL})=>{
 const m=await merchantWithTag(baseURL!),customer=await browser.newContext({baseURL});
 try {
 const page=await customer.newPage();await page.goto(pathOf(m.nextUrl()));await page.getByRole("link",{name:"Karte erstellen",exact:true}).click();await page.getByRole("checkbox").first().check();await page.getByRole("button",{name:/Meine Karte erstellen/}).click();
 await expect(page.getByRole("heading",{name:"Warte auf das Team"})).toBeVisible();const number=await customerCardNumber(page);const pending=await pendingOf(m.cashier);expect((await m.cashier.post(`/api/cashier/tap/${pending[0].id}/confirm`)).status()).toBe(200);await expect(page.locator(".customer-balance-line strong")).toHaveText(/^1\s*Stempel$/);
 const [member]=await sql<{id:string;card_token:string;card_locator:string}>("SELECT id,card_token,card_locator FROM memberships WHERE program_id=$1",[m.me.programId]);
 const now=Math.floor(Date.now()/1000),issued=now-85*86400;
 const payload=Buffer.from(JSON.stringify({token:member.card_token,issued,active:issued,shared:false})).toString("base64url");
 const signature=createHmac("sha256",process.env.BETTER_AUTH_SECRET!).update("loynara-customer-session-v2\0").update(m.me.programId).update("\0").update(payload).digest("base64url");
 await customer.addCookies((await customer.cookies()).filter(c=>c.name.startsWith("loynara_")).map(c=>({...c,value:`v2.${payload}.${signature}`})));
 await page.goto(pathOf(m.nextUrl()));await expect(page.getByRole("heading",{name:"Warte auf das Team"})).toBeVisible();expect(await customerCardNumber(page)).toBe(number);
 const own=(await customer.cookies()).filter(c=>c.name.startsWith("loynara_"));expect(own).toHaveLength(2);
 for(const cookie of own){const data=JSON.parse(Buffer.from(cookie.value.split(".")[1],"base64url").toString());expect(data.issued).toBe(issued);expect(data.active).toBeGreaterThanOrEqual(now);}
 expect((await sql("SELECT count(*)::int n FROM ledger_entries WHERE membership_id=$1",[member.id]))[0].n).toBe(1);
 await page.reload();await expect(page.getByRole("heading",{name:"Warte auf das Team"})).toBeVisible();expect((await customer.cookies()).filter(c=>c.name.startsWith("loynara_")).map(c=>c.value)).toEqual(own.map(c=>c.value));
 await page.goto(`/card/${member.card_token}`);await expect(page.locator(".customer-card-number strong")).toHaveText(number);await page.reload();await expect(page.locator(".customer-card-number strong")).toHaveText(number);
 expect((await customer.cookies()).filter(c=>c.name.startsWith("loynara_")).map(c=>c.value)).toEqual(own.map(c=>c.value));
 const again=await pendingOf(m.cashier);expect(again).toHaveLength(1);expect((await m.cashier.post(`/api/cashier/tap/${again[0].id}/confirm`)).status()).toBe(200);expect((await sql("SELECT delta FROM ledger_entries WHERE membership_id=$1 ORDER BY created_at",[member.id])).map(r=>r.delta)).toEqual([1,1]);
 }finally{await customer.close();await m.close();}
});
