import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// ENG-135: the browser's own validation bubble follows the browser's language (English on many Macs) and its own look.
// Every form checks on submit instead and shows the app's German field errors (ui/form-check).
const tsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? tsx(join(dir, entry.name)) : entry.name.endsWith(".tsx") ? [join(dir, entry.name)] : []);

const files = tsx(join(__dirname, ".."));
const source = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

it("gives every <form> noValidate", () => {
  const missing = files.flatMap(file => [...readFileSync(file, "utf8").matchAll(/<form\b(?:=>|[^>])*>/g)]
    .filter(match => !/\bnoValidate\b/.test(match[0])).map(match => `${file}: ${match[0].slice(0, 80)}`));
  expect(missing).toEqual([]);
});

// A noValidate form with required, minLength or min controls must check them on submit, or nothing stops an empty send.
// These check in their own code instead: join (the consent box, pinned below), the setup and the new-reward steps (problems maps).
const OWN_CHECK = ["components/join-client.tsx", "components/owner/program-setup.tsx", "components/owner/program-new-reward.tsx"];

it("checks the fields of every form that has rules", () => {
  const unchecked = files.filter(file => /<form\b/.test(readFileSync(file, "utf8")) && /\brequired\b|minLength=|\bmin=[{"]/.test(readFileSync(file, "utf8")))
    .filter(file => !readFileSync(file, "utf8").includes(".check(") && !OWN_CHECK.some(path => file.endsWith(path)));
  expect(unchecked).toEqual([]);
});

it("keeps the join page's own words and its consent check (G-01, G-02)", () => {
  const join = source("components/join-client.tsx");
  expect(join).not.toMatch(/cause\.message|cause instanceof Error \?/);
  expect(join).toContain('if (joinNeedsTick(locale, acceptedTerms)) { setError(copy.fr.acceptError); document.getElementById("join-consent")?.focus(); return; }');
});

it("checks a setup logo when it is picked", () => {
  const setup = source("components/owner/program-setup.tsx");
  expect(setup).toContain("onChange={event => void pickLogo(event.target.files?.[0])}");
  expect(setup).toMatch(/const pickLogo = [^\n]*imageToDataUrl\(file\)/);
});
