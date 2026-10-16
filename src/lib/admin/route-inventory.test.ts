import { globSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("every admin API route calls requireAdmin",()=>{
 for(const file of globSync("src/app/api/admin/**/route.ts"))expect(readFileSync(file,"utf8"),file).toContain("requireAdmin(");
});
