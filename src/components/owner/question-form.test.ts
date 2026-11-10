import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// „Speichern“ on an empty screen that needs an answer says what is missing instead of going back unchanged (Design, ENG-164).
it("checks a question's fields before the unchanged answer goes back to the list", () => {
  const source = readFileSync("src/components/owner/question-form.tsx", "utf8");
  const check = source.indexOf("if (!action && !check()) return;"), leave = source.indexOf("if (!action && !changed) { leave(); return; }");
  expect(check).toBeGreaterThan(0);
  expect(leave).toBeGreaterThan(check);
});
