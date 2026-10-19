import { globSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("every admin API route calls requireAdmin",()=>{
 const files=globSync("src/app/api/admin/**/route.ts");
 expect(files.length).toBeGreaterThanOrEqual(2);
 for(const file of files)expect(readFileSync(file,"utf8"),file).toContain("requireAdmin(");
});
