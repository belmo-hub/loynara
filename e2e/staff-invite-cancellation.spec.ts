import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { createStaffInvite } from "../src/lib/staff";
import { pool } from "../src/db";
const origin="http://localhost:3000",database=new URL(process.env.DATABASE_URL??"http://invalid");
if(database.hostname!=="localhost"||database.port!=="55433"||database.pathname!=="/looplocal_browser_invite_101"||process.env.NODE_ENV==="production")throw new Error("Owned disposable invitation browser database required");
let ownerId:string,shop:Awaited<ReturnType<typeof createMerchant>>,storage:Awaited<ReturnType<BrowserContext["storageState"]>>;
test.beforeAll(async({browser,baseURL})=>{
 if(baseURL!==origin)throw new Error("Loopback application required");const email=randomUUID()+"@example.test",password="Synthetic!Browser101Password";
 ownerId=(await auth.api.signUpEmail({body:{name:"Synthetic cancellation owner",email,password}})).user.id;
 shop=await createMerchant({userId:ownerId,businessName:"Synthetic invite browser",city:"Kassel",country:"DE",timezone:"Europe/Berlin",locale:"de",currency:"EUR",programName:"Synthetic",programType:"stamp",rulesText:"One confirmed synthetic award",rewardTitle:"Coffee",rewardCost:5});
 const context=await browser.newContext({baseURL,extraHTTPHeaders:{Origin:origin}});
 try{expect((await context.request.post("/api/auth/sign-in/email",{data:{email,password}})).status()).toBe(200);storage=await context.storageState();}finally{await context.close();}
});
test.afterAll(async()=>{await pool.end();});
for(const width of [375,1280])test(`owner cancels pending invitation and reloads authoritative state at ${width}px`,async({browser,baseURL})=>{
 const email=randomUUID()+"@example.test",invite=await createStaffInvite({actorUserId:ownerId,locationId:shop.locationId,email,role:"cashier"});
 const context=await browser.newContext({baseURL,storageState:storage,extraHTTPHeaders:{Origin:origin},viewport:{width,height:844}});
 try{const page=await context.newPage();await page.goto("/merchant/staff");const section=page.locator('section[aria-labelledby="st-invitations"]'),row=section.getByRole("listitem").filter({hasText:email});
 await expect(row).toContainText("Offen");await row.getByRole("button",{name:"Widerrufen",exact:true}).click();await page.getByRole("button",{name:"Einladung widerrufen",exact:true}).click();
 await expect(row).toContainText("Widerrufen");await expect(row.getByRole("button")).toHaveCount(0);await page.reload();await expect(row).toContainText("Widerrufen");
 expect((await pool.query("SELECT revoked_at IS NOT NULL AS revoked FROM staff_invites WHERE id=$1",[invite.id])).rows).toEqual([{revoked:true}]);
 expect((await pool.query("SELECT count(*)::int AS n FROM staff_audit_events WHERE invite_id=$1 AND action='access_revoked'",[invite.id])).rows).toEqual([{n:1}]);
 expect((await pool.query("SELECT count(*)::int AS n FROM staff_roles WHERE tenant_id=$1",[shop.tenantId])).rows).toEqual([{n:1}]);
 expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE tenant_id=$1 AND kind LIKE 'email.%'",[shop.tenantId])).rows).toEqual([{n:0}]);
 if(width===375)await section.screenshot({path:"/tmp/loy-101-invitation-mobile.png",animations:"disabled"});
 }finally{await context.close();}
});
test("failed and mismatched cancellation responses never confirm another invitation",async({browser,baseURL})=>{
 const email=randomUUID()+"@example.test",invite=await createStaffInvite({actorUserId:ownerId,locationId:shop.locationId,email,role:"manager"});
 const context=await browser.newContext({baseURL,storageState:storage,extraHTTPHeaders:{Origin:origin},viewport:{width:375,height:844}});
 try{const page=await context.newPage();await page.goto("/merchant/staff");const row=page.locator('section[aria-labelledby="st-invitations"]').getByRole("listitem").filter({hasText:email});
 for(const mismatched of [false,true]){
  await page.route("**/api/staff/invite/revoke",route=>route.fulfill({status:mismatched?200:500,contentType:"application/json",body:JSON.stringify(mismatched?{inviteId:randomUUID(),status:"revoked"}:{error:"Synthetic cancellation unavailable"})}));
  await row.getByRole("button",{name:"Widerrufen",exact:true}).click();await page.getByRole("button",{name:"Einladung widerrufen",exact:true}).click();
  await expect(page.locator('.ow-notice[role="alert"]')).toBeVisible();await expect(page.getByRole("alertdialog")).toHaveCount(0);await expect(row).toContainText("Offen");
  await expect(page.getByText(`Die Einladung für ${email} wurde widerrufen.`,{exact:true})).toHaveCount(0);await page.unroute("**/api/staff/invite/revoke");
 }
 expect((await pool.query("SELECT revoked_at FROM staff_invites WHERE id=$1",[invite.id])).rows).toEqual([{revoked_at:null}]);
 await row.getByRole("button",{name:"Widerrufen",exact:true}).click();await page.getByRole("button",{name:"Einladung widerrufen",exact:true}).click();await expect(row).toContainText("Widerrufen");
 }finally{await context.close();}
});

test("a delayed committed cancellation cannot close a newer invitation confirmation",async({browser,baseURL})=>{
 const emailA=randomUUID()+"@example.test",emailB=randomUUID()+"@example.test";
 const inviteA=await createStaffInvite({actorUserId:ownerId,locationId:shop.locationId,email:emailA,role:"cashier"});
 const inviteB=await createStaffInvite({actorUserId:ownerId,locationId:shop.locationId,email:emailB,role:"manager"});
 const context=await browser.newContext({baseURL,storageState:storage,extraHTTPHeaders:{Origin:origin},viewport:{width:375,height:844}});
 let release!:()=>void,committed!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{committed=resolve;});
 try{
  const page=await context.newPage();
  await page.route("**/api/staff/invite/revoke",async route=>{
   const response=await route.fetch();committed();await held;await route.fulfill({response});
  });
  await page.goto("/merchant/staff");const section=page.locator('section[aria-labelledby="st-invitations"]');
  const rowA=section.getByRole("listitem").filter({hasText:emailA}),rowB=section.getByRole("listitem").filter({hasText:emailB});
  await rowA.getByRole("button",{name:"Widerrufen",exact:true}).click();await page.getByRole("button",{name:"Einladung widerrufen",exact:true}).click();await ready;
  await page.getByRole("alertdialog").getByRole("button",{name:"Abbrechen",exact:true}).click();
  await rowB.getByRole("button",{name:"Widerrufen",exact:true}).click();release();
  await expect(rowA).toContainText("Widerrufen");await expect(rowB).toContainText("Offen");
  await expect(page.getByRole("alertdialog")).toContainText(emailB);await expect(page.getByRole("button",{name:"Einladung widerrufen",exact:true})).toBeEnabled();
  await expect(page.getByText(`Die Einladung für ${emailA} wurde widerrufen.`,{exact:true})).toBeVisible();
  await expect(page.getByText(`Die Einladung für ${emailB} wurde widerrufen.`,{exact:true})).toHaveCount(0);
  expect((await pool.query("SELECT id, revoked_at IS NOT NULL AS revoked FROM staff_invites WHERE id=ANY($1) ORDER BY id",[[inviteA.id,inviteB.id]])).rows).toEqual([{id:inviteA.id,revoked:true},{id:inviteB.id,revoked:false}].sort((a,b)=>a.id.localeCompare(b.id)));
  await page.getByRole("alertdialog").getByRole("button",{name:"Abbrechen",exact:true}).click();
 }finally{release();await context.close();}
});
