import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ENG-100 D5 guard (CTO note 2): the programmes row is the newest saved rule, which may still wait for its date, so code
// that tells a customer or the counter what applies reads earning mode, rate, rules text and expiry through
// programInForce. Name and type are left out: they only ever change at once (a type change needs a programme without
// cards), so the row always equals the version in force for them.
const FIELDS = "rulesText|earningMode|pointsPerCurrencyUnit|pointsExpiryMonths|pointsExpirySince";
/** Always the stored row or column: a drizzle column, raw SQL, or a field of a joined row (`row.program.…`). */
const DIRECT = new RegExp(`\\bprograms\\.(${FIELDS})\\b|\\.program\\.(${FIELDS})\\b|\\b(earning_mode|points_per_euro|rules_text|points_expiry_months|points_expiry_since)\\b`);
/** A programme object's field: fine where the function took the programme from programInForce. */
const FIELD = new RegExp(`\\bprogram\\??\\.(${FIELDS})\\b`);

/** Owner baseline (the newest saved rule, edited and shown back to the owner), writers, owner-only views and pure helpers. */
const ALLOWED = new Set([
  "src/lib/product.ts createMerchant", "src/lib/product.ts startProgramme", "src/lib/product.ts updateProgram", "src/lib/product.ts updateProgramExtras",
  "src/lib/product.ts saveExpiry", "src/lib/product.ts getMerchantContext",
  "src/lib/product.ts shownRules", "src/lib/product.ts publicRules", // pure: the card, join page and Wallet pass it the programme in force
  "src/lib/locations.ts createAdditionalLocation", "src/lib/nfc-test-db.ts nfcFixture",
  "src/lib/merchant-members.ts listMerchantMembers", "src/lib/merchant-members.ts getMerchantMember", // owner list
  "src/lib/secure-tap.ts setTapPolicy", // owner setting; points taps are always staff-confirmed whatever the mode
  "src/lib/points-expiry.ts candidates", // a coarse prefilter: each card's expiry is then read through programInForce
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && !path.endsWith("rule-versions.ts") ? [path] : [];
  });
}

/** Top-level functions (and consts) of a file with their source text. */
function functions(text: string) {
  const parts: Array<{ name: string; body: string }> = [];
  for (const line of text.split("\n")) {
    const head = /^(?:export )?(?:async )?function\*? (\w+)|^(?:export )?const (\w+)\s*=/.exec(line);
    if (head || !parts.length) parts.push({ name: head ? head[1] ?? head[2] : "(top)", body: "" });
    parts[parts.length - 1].body += `${line}\n`;
  }
  return parts;
}

describe("customer reads of the versioned programme rule (ENG-100 D5)", () => {
  it("go through programInForce outside the owner baseline", () => {
    const offenders = [...sources("src/lib"), ...sources("src/app"), ...sources("scripts")].flatMap(file => functions(readFileSync(file, "utf8"))
      .filter(fn => !ALLOWED.has(`${file} ${fn.name}`) && (DIRECT.test(fn.body) || (FIELD.test(fn.body) && !fn.body.includes("programInForce("))))
      .map(fn => `${file} ${fn.name}`));
    expect(offenders).toEqual([]);
  });

  it("catches a direct read", () => {
    const [award] = functions("async function award() {\n  const [program] = await tx.select().from(programs);\n  return program.pointsPerCurrencyUnit;\n}\n");
    expect(FIELD.test(award.body) && !award.body.includes("programInForce(")).toBe(true);
    expect(DIRECT.test("const shown = row.program.rulesText;")).toBe(true);
    expect(DIRECT.test("select({ rate: programs.pointsPerCurrencyUnit })")).toBe(true);
  });
});
