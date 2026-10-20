import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({session:vi.fn(),close:vi.fn(),receipt:vi.fn(),activity:vi.fn(),reviews:vi.fn(),ack:vi.fn(),peer:vi.fn(),rate:vi.fn(),event:vi.fn()}));
vi.mock("@/lib/auth",()=>({auth:{api:{getSession:mocks.session}}}));
vi.mock("@/lib/merchant-deletion",()=>({closeMerchant:mocks.close,deletionReceipt:mocks.receipt}));
vi.mock("@/lib/inactivity",()=>({recordCustomerActivity:mocks.activity,merchantInactivity:mocks.reviews,acknowledgeInactivity:mocks.ack}));
vi.mock("@/lib/operational-signals",()=>({recordOperationalEvent:mocks.event}));
vi.mock("@/lib/rate-limit",async importOriginal=>({...await importOriginal<typeof import("@/lib/rate-limit")>(),enforcePeerLimit:mocks.peer,enforceRateLimit:mocks.rate}));
import { DomainError } from "@/lib/loyalty";
import { POST as close } from "./merchant/close/route";
import { GET as reviews, POST as acknowledge } from "./merchant/inactivity/route";
import { GET as receipt } from "./privacy/receipts/[id]/route";
import { POST as activity } from "./card/[token]/activity/route";
const tenantId="00000000-0000-4000-8000-000000000001",memberId="00000000-0000-4000-8000-000000000002";
const valid={tenantId,confirmation:"Synthetic merchant"};
const request=(body:unknown,origin="https://synthetic.example.test")=>new Request("https://synthetic.example.test/api",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("PUBLIC_BASE_URL","https://synthetic.example.test");mocks.session.mockResolvedValue({user:{id:"owner"},session:{id:"recent-login"}});mocks.close.mockResolvedValue({closed:true,receiptId:memberId});mocks.activity.mockResolvedValue({recorded:true});mocks.ack.mockResolvedValue({reviewed:true});mocks.reviews.mockResolvedValue([]);mocks.receipt.mockResolvedValue({id:memberId,scope:"member"});});
afterEach(()=>vi.unstubAllEnvs());
describe("lifecycle HTTP boundaries",()=>{
 it("binds merchant closure to the authenticated actor and login session",async()=>{
  const response=await close(request(valid));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.close).toHaveBeenCalledWith({...valid,actorUserId:"owner",sessionId:"recent-login"});expect(mocks.peer).toHaveBeenCalledOnce();expect(mocks.rate).toHaveBeenCalledOnce();
 });
 it("refuses cross-origin requests, missing login, oversized bodies and forged actors before closure",async()=>{
  expect((await close(request(valid,"https://foreign.example.test"))).status).toBe(403);
  mocks.session.mockResolvedValueOnce(null);expect((await close(request(valid))).status).toBe(401);
  expect((await close(request({...valid,actorUserId:"another-owner"}))).status).toBe(400);
  expect((await close(request({...valid,confirmation:"x".repeat(2000)}))).status).toBe(400);
  expect(mocks.close).not.toHaveBeenCalled();
 });
 it("returns failure and operational evidence instead of a closed receipt on archive refusal",async()=>{
  mocks.close.mockRejectedValueOnce(new DomainError("CLOSURE_ARCHIVE_UNAVAILABLE","Closure could not be saved safely"));
  const response=await close(request(valid));expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty("closed");expect(mocks.event).toHaveBeenCalledWith("request_error");
 });
 it("binds monthly review and acknowledgement to the owner session and rejects extra fields",async()=>{
  const response=await reviews(new Request("https://synthetic.example.test/api"));expect(response.headers.get("cache-control")).toBe("no-store");expect(mocks.reviews).toHaveBeenCalledWith("owner");
  expect((await acknowledge(request({membershipId:memberId,actorUserId:"forged"}))).status).toBe(400);expect(mocks.ack).not.toHaveBeenCalled();
  expect((await acknowledge(request({membershipId:memberId}))).status).toBe(200);expect(mocks.ack).toHaveBeenCalledWith("owner",memberId);
 });
 it("requires same origin and both limits before customer activity can renew inactivity",async()=>{
  const context={params:Promise.resolve({token:"synthetic-private-bearer"})};
  expect((await activity(request({},"https://foreign.example.test"),context)).status).toBe(403);expect(mocks.activity).not.toHaveBeenCalled();
  mocks.rate.mockRejectedValueOnce(new DomainError("RATE_LIMIT","Try later"));expect((await activity(request({}),context)).status).toBe(429);expect(mocks.activity).not.toHaveBeenCalled();
  expect((await activity(request({}),context)).status).toBe(200);expect(mocks.activity).toHaveBeenCalledWith("synthetic-private-bearer");
 });
 it("serves private noncached receipts only after the peer limit permits lookup",async()=>{
  const context={params:Promise.resolve({id:memberId})};const req=new Request("https://synthetic.example.test/api");
  mocks.peer.mockRejectedValueOnce(new DomainError("RATE_LIMIT","Try later"));expect((await receipt(req,context)).status).toBe(429);expect(mocks.receipt).not.toHaveBeenCalled();
  const response=await receipt(req,context);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");expect(mocks.receipt).toHaveBeenCalledWith(memberId);
 });
});
