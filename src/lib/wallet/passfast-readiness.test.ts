import { afterEach, describe, expect, it, vi } from "vitest";
import { PassFastClient, passFastConfig, passFastStatus } from "./passfast";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const template = "0d283e79-17ba-48ca-9b2d-438487644190";
const app = "fe0f1e68-4655-41d2-b805-813281911f79";
const serial = "e8586555-738e-4b7a-879c-90708acb5c52";
const env = { PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: app, PASSFAST_TEMPLATE_ID: serial };
const bindings = JSON.stringify([{tenantId:tenant, templateId:template}]);
const remote = {id:tenant, serial_number:serial, external_id:serial, app_id:app, template_id:serial, wallet_type:"apple", status:"active"};
afterEach(() => vi.restoreAllMocks());
describe("PassFast production readiness boundaries, no network", () => {
  it("selects only the database-resolved tenant's server template", () => {
    expect(passFastConfig({...env, PASSFAST_TENANT_TEMPLATES:bindings},tenant).templateId).toBe(template);
    expect(() => passFastConfig({...env, PASSFAST_TENANT_TEMPLATES:bindings},other)).toThrow();
  });
  it.each([
    JSON.stringify([{tenantId:tenant,templateId:template},{tenantId:tenant,templateId:serial}]),
    JSON.stringify([{tenantId:tenant,templateId:template},{tenantId:other,templateId:template}]),
    JSON.stringify([{tenantId:tenant,templateId:template,apiKey:env.PASSFAST_API_KEY}]),
    '{}', '[]', 'not-json'
  ])("rejects ambiguous, shared or credential-bearing bindings %s", value => {
    expect(passFastStatus({...env, PASSFAST_TENANT_TEMPLATES:value}).ready).toBe(false);
  });
  it("requires an explicit production allowlist even with an approved global template", () => {
    const production = {...env, NODE_ENV:"production", WALLET_PRODUCTION_APPROVED:"true", PASSFAST_API_KEY:"sk_live_0123456789abcdef0123456789abcdef"};
    expect(passFastStatus(production).ready).toBe(false);
    expect(passFastStatus({...production,PASSFAST_TENANT_TEMPLATES:bindings}).ready).toBe(true);
    expect(passFastStatus({...production,PASSFAST_TENANT_TEMPLATES:bindings,PASSFAST_ENABLED:"false"}).ready).toBe(false);
  });
  it.each(["app_id","template_id","external_id"])("rejects missing or foreign %s before any mutation", async field => {
    for(const value of [undefined,other]) {
      const client = new PassFastClient(passFastConfig(env), async () => Response.json({...remote,[field]:value}));
      await expect(client.get(serial,"apple")).rejects.toThrow("PassFast operation failed");
    }
  });
  it("gives transport and response streaming one 45 second timeout and never caches reconciliation", async () => {
    const timeout = vi.spyOn(globalThis,"setTimeout");
    let options: RequestInit | undefined;
    const client = new PassFastClient(passFastConfig(env),async (_url,init) => {options=init;return Response.json(remote);});
    await expect(client.get(serial,"apple")).resolves.toMatchObject({status:"active"});
    expect(timeout.mock.calls.some(call=>call[1]===45000)).toBe(true);
    expect(options?.cache).toBe("no-store");
    expect(options?.redirect).toBe("error");
  });
  it("accepts the measured 12.5 second update without the former 10 second cutoff", async () => {
    vi.useFakeTimers();
    try {
      const client=new PassFastClient(passFastConfig(env),async()=>{
        await new Promise(resolve=>setTimeout(resolve,12500));
        return Response.json({id:tenant,status:"active"});
      });
      const result=expect(client.update(serial,"apple",{balance:1})).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(12500);
      await result;
    } finally {vi.useRealTimers();}
  });
  it("refuses a request after the shared operation deadline without contacting the provider", async () => {
    const fetcher = vi.fn(async () => Response.json(remote));
    const client = new PassFastClient(passFastConfig(env),fetcher,Date.now()-1);
    await expect(client.get(serial,"apple")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds a stalled response body and cancels the reader", async () => {
    vi.useFakeTimers();
    try {
      let cancelled=false;
      const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
      const client=new PassFastClient(passFastConfig(env),async()=>new Response(body,{headers:{"content-type":"application/json"}}));
      const result=expect(client.get(serial,"apple")).rejects.toThrow("PassFast operation failed");
      await vi.advanceTimersByTimeAsync(45000);
      await result;
      expect(cancelled).toBe(true);
    } finally {vi.useRealTimers();}
  });
});
