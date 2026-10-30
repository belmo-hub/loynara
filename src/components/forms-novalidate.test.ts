import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// ENG-135: the browser's own validation bubble follows the browser's language (English on many Macs) and its own look.
// Every form checks on submit instead and shows the app's German field errors (ui/form-check).
const tsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? tsx(join(dir, entry.name)) : entry.name.endsWith(".tsx") ? [join(dir, entry.name)] : []);

it("gives every <form> noValidate", () => {
  const missing = tsx(join(__dirname, "..")).flatMap(file => [...readFileSync(file, "utf8").matchAll(/<form\b(?:=>|[^>])*>/g)]
    .filter(match => !/\bnoValidate\b/.test(match[0])).map(match => `${file}: ${match[0].slice(0, 80)}`));
  expect(missing).toEqual([]);
});
