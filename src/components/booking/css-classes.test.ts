import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";

// Design, 22 Nov (blocker 1): the booking page referenced classes railway-rc's card redesign had removed, and rendered
// unstyled. Every `alias.name` a booking component reads from an imported CSS module must be defined there.
const FILES = ["src/components/booking/customer-flow.tsx", "src/components/booking/card-booking.tsx", "src/components/booking/booking-push.tsx"];

it.each(FILES)("%s uses only classes its CSS modules define", file => {
  const full = readFileSync(file, "utf8"), source = full.replace(/^import .*$/gm, ""), missing: string[] = [];
  for (const [, alias, path] of full.matchAll(/^import (\w+) from "([^"]+\.module\.css)";/gm)) {
    const css = readFileSync(path.startsWith("@/") ? resolve("src", path.slice(2)) : resolve(dirname(file), path), "utf8");
    const defined = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m => m[1]));
    for (const [, name] of source.matchAll(new RegExp(`\\b${alias}\\.([a-zA-Z_]\\w*)`, "g"))) if (!defined.has(name)) missing.push(`${alias}.${name}`);
  }
  expect([...new Set(missing)]).toEqual([]);
});
