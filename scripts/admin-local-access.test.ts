import { afterEach, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";
import { createLocalAccess } from "./admin-local-access";
import { verifyAccessAssertion } from "../src/lib/admin/access";
afterEach(()=>vi.unstubAllEnvs());
it("refuses in production",async()=>{vi.stubEnv("NODE_ENV","production");vi.stubEnv("ADMIN_ALLOWED_EMAILS","admin@example.test");await expect(createLocalAccess("admin@example.test")).rejects.toThrow(/production/i);});
it("signs a token that verifyAccessAssertion accepts in local_test mode",async()=>{
 vi.stubEnv("ADMIN_ALLOWED_EMAILS","admin@example.test");const result=await createLocalAccess("admin@example.test");
 expect(await verifyAccessAssertion(result.token,{ADMIN_ACCESS_MODE:"local_test",ADMIN_ACCESS_TEST_JWKS:JSON.stringify(result.jwks),ADMIN_ALLOWED_EMAILS:"admin@example.test"})).toEqual({email:"admin@example.test"});
 const claims=decodeJwt(result.token);expect(claims.exp!-claims.iat!).toBe(43200);expect(result.jwks.keys.every(key=>!("d" in key))).toBe(true);
});
it("refuses an email outside the local allow list",async()=>{vi.stubEnv("ADMIN_ALLOWED_EMAILS","admin@example.test");await expect(createLocalAccess("other@example.test")).rejects.toThrow();});
