import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { issueCustomerSession, readCustomerSession } from "./customer-session";
const programme=randomUUID(), token=`card_${"A".repeat(43)}`;
const started=Date.parse("2026-10-09T12:00:00Z")/1000;
const day=86400;
beforeEach(()=>{vi.stubEnv("BETTER_AUTH_SECRET","synthetic-session-signing-secret-at-least-32");vi.spyOn(Date,"now").mockReturnValue(started*1000);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it("signs v2 credentials with an immutable root and activity deadline",()=>{
  const value=issueCustomerSession(programme,token);
  expect(value.startsWith("v2.")).toBe(true);
  expect(readCustomerSession(value,programme)).toMatchObject({issued:started,lastActivity:started,shared:false});
});
it("rotates envelopes while preserving the original authentication timestamp",()=>{
  const first=issueCustomerSession(programme,token,true);
  vi.spyOn(Date,"now").mockReturnValue((started+85*day)*1000);
  const next=issueCustomerSession(programme,token,true,started,started+85*day);
  expect(next).not.toBe(first);
  vi.spyOn(Date,"now").mockReturnValue((started+95*day)*1000);
  expect(readCustomerSession(first,programme)).toBeUndefined();
  expect(readCustomerSession(next,programme)).toMatchObject({issued:started,lastActivity:started+85*day,shared:true});
});
it.each([89,90,91])("independently enforces inactivity on day %s",days=>{
 const value=issueCustomerSession(programme,token);
 vi.spyOn(Date,"now").mockReturnValue((started+days*day)*1000);
 expect(Boolean(readCustomerSession(value,programme))).toBe(days<90);
});
it("hard-expires at 365 days even after recent meaningful activity",()=>{
 vi.spyOn(Date,"now").mockReturnValue((started+350*day)*1000);
 const value=issueCustomerSession(programme,token,false,started,started+350*day);
 vi.spyOn(Date,"now").mockReturnValue((started+364*day)*1000);
 expect(readCustomerSession(value,programme)).toBeDefined();
 vi.spyOn(Date,"now").mockReturnValue((started+365*day)*1000);
 expect(readCustomerSession(value,programme)).toBeUndefined();
});
it("rejects future activity, activity before authentication and already expired issuance",()=>{
 expect(()=>issueCustomerSession(programme,token,false,started,started+1)).toThrow();
 expect(()=>issueCustomerSession(programme,token,false,started,started-1)).toThrow();
 vi.spyOn(Date,"now").mockReturnValue((started+365*day)*1000);
 expect(()=>issueCustomerSession(programme,token,false,started,started+350*day)).toThrow();
});

it("award-and-Done activity on days 1/30/60/85/95 retains recognition without moving the root",()=>{
 let value=issueCustomerSession(programme,token);
 for(const days of [1,30,60,85,95]){
  vi.spyOn(Date,"now").mockReturnValue((started+days*day)*1000);
  expect(readCustomerSession(value,programme)).toMatchObject({issued:started});
  value=issueCustomerSession(programme,token,false,started,started+days*day);
 }
 vi.spyOn(Date,"now").mockReturnValue((started+185*day)*1000);
 expect(readCustomerSession(value,programme)).toBeUndefined();
});
