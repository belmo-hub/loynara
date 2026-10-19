import { expect, it } from "vitest";
import { can, STEP_UP_CAPABILITIES, type AdminRole, type Capability } from "./capabilities";
const matrix: [Capability, boolean, boolean, boolean][] = [
 ["home.view",true,true,true],["home.money",true,true,false],
 ["shops.view",true,true,true],["shops.note",true,true,true],["plaques.view",true,true,true],
 ["plaques.link",true,true,false],["plaques.code",true,true,false],["plaques.retire",true,true,false],
 ["support.reset_link",true,true,false],["support.resend_invite",true,true,false],["support.unlock",true,true,false],
 ["leads.view",true,true,true],["leads.edit",true,true,true],["leads.invite",true,false,true],
 ["money.view_full",true,false,false],["money.view_status",true,true,true],["money.write",true,false,false],
 ["health.view",true,true,false],["health.retry",true,true,false],["customers.reveal",true,false,false],
 ["audit.view_all",true,false,false],["audit.view_own",true,true,true],["admins.reset_2fa",true,false,false],
];
it("matches the spec role table",()=>{
 for (const [cap,...expected] of matrix) for (const [i,role] of (["founder","support","sales"] as AdminRole[]).entries()) expect(can([role],cap),`${role}: ${cap}`).toBe(expected[i]);
 expect(can([],"home.view")).toBe(false);
});
it("combines roles",()=>{ expect(can(["support","sales"],"leads.invite")).toBe(true);expect(can(["support","sales"],"money.write")).toBe(false); });
it("step-up set matches the spec",()=>expect([...STEP_UP_CAPABILITIES].sort()).toEqual(["plaques.link","plaques.code","plaques.retire","support.unlock","leads.invite","money.write","health.retry","customers.reveal","admins.reset_2fa"].sort()));
