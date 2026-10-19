import { expect, it } from "vitest";
import { parseAdminArgs, assertAdminConfirmation } from "./admin-operator";
const local={NODE_ENV:"test",DATABASE_URL:"postgresql://looplocal:synthetic@localhost:55433/looplocal",BETTER_AUTH_URL:"http://localhost:3000",PUBLIC_BASE_URL:"http://localhost:3000"};
it("refuses an unknown role",()=>expect(()=>parseAdminArgs(["grant","--target","local","--email","admin@example.test","--role","owner"],local)).toThrow());
it("refuses production without the production markers",()=>expect(()=>parseAdminArgs(["list","--target","loynara-production"],local)).toThrow());
it("requires the typed confirmation",()=>{
 const expected="GRANT support admin@example.test";expect(()=>assertAdminConfirmation(expected,undefined)).toThrow();expect(()=>assertAdminConfirmation(expected,"yes")).toThrow();expect(()=>assertAdminConfirmation(expected,expected)).not.toThrow();
});
