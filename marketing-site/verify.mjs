import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "site");
const pages = ["index.html", "demo/index.html"];
for (const page of pages) {
  const html = readFileSync(resolve(root, page), "utf8");
  assert.match(html, /<html lang="de">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/getloynara\.com\//);
  assert.match(html, /Loynara/);
  assert.doesNotMatch(html, /LoopLocal|looplocal\.|localhost|preview\.getloynara\.com|card_[A-Za-z0-9_-]{10,}|password/i);
  for (const asset of html.matchAll(/(?:src|href)="(\/assets\/[^"#]+|\/styles\.css)"/g)) {
    assert.ok(existsSync(resolve(root, `.${asset[1]}`)), `${page}: missing ${asset[1]}`);
  }
  console.log(`${page}: metadata, branding and referenced assets PASS`);
}
for (const path of ["styles.css", "robots.txt", "sitemap.xml", "_headers", "assets/loynara-full-platform-synthetic.mp4"]) {
  assert.ok(statSync(resolve(root, path)).size > 0, `missing or empty ${path}`);
}
assert.match(readFileSync(resolve(root, "_headers"), "utf8"), /script-src 'none'/);
console.log("Static marketing bundle PASS; no private origin or bearer link in public HTML");
