import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Which class selectors in a global stylesheet are still referenced by code. A class counts as used when its name
 * appears as a whole token in any .ts/.tsx file under the given roots (classNames, cx() arguments, spec locators).
 * Token matching errs towards "used" for common words, never towards deleting a live rule.
 *
 *   npx tsx src/styles/css-usage.ts [src/app/globals.css]   prints every class with its reference count
 */
export function classSelectors(css: string): string[] {
  const withoutNoise = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "").replace(/\{[^{}]*\}/g, "{}");
  const names = new Set<string>();
  for (const match of withoutNoise.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) names.add(match[1]);
  return [...names].sort();
}

function sourceFiles(root: string, skip: Set<string>): string[] {
  return readdirSync(root).flatMap(entry => {
    const path = join(root, entry);
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path, skip);
    return /\.(ts|tsx)$/.test(entry) && !skip.has(path) ? [path] : [];
  });
}

export function classUsage(cssPath: string, roots: string[], skip: string[] = []): Array<{ name: string; references: number }> {
  const code = roots.flatMap(root => sourceFiles(root, new Set(skip))).map(file => readFileSync(file, "utf8")).join("\n");
  return classSelectors(readFileSync(cssPath, "utf8")).map(name => {
    const token = new RegExp(`(?<![\\w-])${name.replace(/[-]/g, "\\-")}(?![\\w-])`, "g");
    return { name, references: code.match(token)?.length ?? 0 };
  });
}

if (process.argv[1]?.endsWith("css-usage.ts")) {
  const cssPath = process.argv[2] ?? "src/app/globals.css";
  const usage = classUsage(cssPath, ["src", "e2e"], ["src/styles/css-usage.ts", "src/app/globals-css.test.ts"]);
  for (const { name, references } of usage) console.log(`${String(references).padStart(4)}  .${name}`);
  console.log(`${usage.length} classes, ${usage.filter(item => item.references === 0).length} unreferenced`);
}
