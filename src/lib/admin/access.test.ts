import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyAccessAssertion, type AccessEnv } from "./access";
let keys: Awaited<ReturnType<typeof generateKeyPair>>, env: AccessEnv;
beforeAll(async()=>{keys=await generateKeyPair("ES256");env={ADMIN_ACCESS_MODE:"local_test",ADMIN_ACCESS_TEST_JWKS:JSON.stringify({keys:[{...await exportJWK(keys.publicKey),kid:"local"}]}),ADMIN_ALLOWED_EMAILS:"founder@example.test"};});
afterEach(()=>vi.unstubAllEnvs());
async function token(options: {aud?: string;email?: string;expired?: boolean;bad?: boolean}={}){
 const signer=options.bad?(await generateKeyPair("ES256")).privateKey:keys.privateKey;
 return new SignJWT({email:options.email??"Founder@Example.test"}).setProtectedHeader({alg:"ES256",kid:"local"}).setIssuer("https://loynara-local-access.invalid").setAudience(options.aud??"loynara-local-admin").setExpirationTime(options.expired?0:"1h").sign(signer);
}
it("accepts a valid token",async()=>expect(await verifyAccessAssertion(await token(),env)).toEqual({email:"founder@example.test"}));
it("rejects a missing token",async()=>expect(verifyAccessAssertion(null,env)).rejects.toMatchObject({code:"NOT_FOUND"}));
it("rejects a bad signature",async()=>expect(verifyAccessAssertion(await token({bad:true}),env)).rejects.toMatchObject({code:"NOT_FOUND"}));
it("rejects the wrong audience",async()=>expect(verifyAccessAssertion(await token({aud:"other"}),env)).rejects.toMatchObject({code:"NOT_FOUND"}));
it("rejects an expired token",async()=>expect(verifyAccessAssertion(await token({expired:true}),env)).rejects.toMatchObject({code:"NOT_FOUND"}));
it("rejects an email not on the allow list",async()=>expect(verifyAccessAssertion(await token({email:"other@example.test"}),env)).rejects.toMatchObject({code:"NOT_FOUND"}));
it("refuses local_test in production",async()=>{const signed=await token();vi.stubEnv("NODE_ENV","production");await expect(verifyAccessAssertion(signed,env)).rejects.toMatchObject({code:"NOT_FOUND"});});
