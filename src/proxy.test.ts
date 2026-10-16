import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function request(path: string, method = "GET", host = "mail-events.getloynara.com") {
  return new NextRequest(`https://${host}${path}`, { method, headers: { host } });
}

describe("Mailgun callback hostname isolation", () => {
  it("allows only POST to the exact webhook path", () => {
    expect(proxy(request("/api/email/mailgun/webhook", "POST")).status).toBe(200);
    for (const path of ["/", "/api/health", "/api/email/mailgun/webhook/extra", "/merchant", "/card/private-token"]) {
      expect(proxy(request(path, "POST")).status).toBe(404);
    }
    expect(proxy(request("/api/email/mailgun/webhook", "GET")).status).toBe(404);
  });

  it("leaves the Access-protected preview hostname on its existing route", () => {
    expect(proxy(request("/merchant", "GET", "preview.getloynara.com")).status).toBe(200);
  });
});

describe("public unsubscribe hostname isolation", () => {
  afterEach(() => { delete process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN; });
  it("allows only the confirmation page, POST endpoint and required static assets", () => {
    process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN = "https://unsubscribe.getloynara.com";
    const host = "unsubscribe.getloynara.com";
    expect(proxy(request("/unsubscribe", "GET", host)).status).toBe(200);
    expect(proxy(request("/api/unsubscribe", "POST", host)).status).toBe(200);
    expect(proxy(request("/_next/static/chunks/example.js", "GET", host)).status).toBe(200);
    for (const path of ["/", "/merchant", "/api/health", "/card/private-token", "/api/unsubscribe/extra"]) {
      expect(proxy(request(path, "GET", host)).status).toBe(404);
    }
    expect(proxy(request("/api/unsubscribe", "GET", host)).status).toBe(404);
    expect(proxy(request("/unsubscribe", "POST", host)).status).toBe(404);
  });
});

describe("admin hostname isolation",()=>{
  afterEach(()=>vi.unstubAllEnvs());
  const call=(host:string,path:string)=>proxy(new NextRequest(`https://${host}${path}`,{headers:{host}}));
  it("serves admin paths on the admin host",()=>{
    vi.stubEnv("ADMIN_ORIGIN","https://admin.getloynara.com");
    for(const path of ["/admin","/admin/team","/api/admin/step-up","/api/auth/sign-in/email","/_next/static/test.js","/_next/image","/icon.svg","/favicon.ico"])expect(call("admin.getloynara.com",path).status,path).toBe(200);
  });
  it("hides merchant, card and tap paths on the admin host",()=>{
    vi.stubEnv("ADMIN_ORIGIN","https://admin.getloynara.com");
    for(const path of ["/merchant","/card/x","/tap/x","/join/x","/api/merchant/tap"]){const result=call("admin.getloynara.com",path);expect(result.status,path).toBe(404);expect(result.headers.get("cache-control")).toBe("no-store");}
  });
  it("hides admin paths on the app host",()=>{
    vi.stubEnv("ADMIN_ORIGIN","https://admin.getloynara.com");
    for(const path of ["/admin","/admin/team","/api/admin","/api/admin/step-up"])expect(call("app.getloynara.com",path).status,path).toBe(404);
  });
  it("hides admin paths when no admin origin is configured",()=>{
    vi.stubEnv("ADMIN_ORIGIN","");for(const path of ["/admin","/api/admin/step-up"])expect(call("app.getloynara.com",path).status).toBe(404);
  });
});
