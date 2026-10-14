import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

// The root tsconfig type-checks marketing-site/src during `next build`, and the production Docker image installs only the
// root package.json. A package imported here but declared only in marketing-site/package.json builds locally (where that
// folder has its own node_modules) and fails in a clean image with TS2307.
const SRC = join(import.meta.dirname, '..', 'src');
const root = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const declared = new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})]);
const builtins = new Set(builtinModules);

const packageOf = (specifier: string) => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);

test('every package imported by marketing-site/src is declared in the root package.json', () => {
  const missing = new Set<string>();
  for (const file of readdirSync(SRC).filter((name) => name.endsWith('.ts'))) {
    const code = readFileSync(join(SRC, file), 'utf8');
    for (const match of code.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n;]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      const name = packageOf(specifier);
      if (!builtins.has(name) && !declared.has(name)) missing.add(`${name} (${file})`);
    }
  }
  assert.deepEqual([...missing], []);
});

test('motion, imported by the page script, is declared at the root', () => {
  assert.ok(declared.has('motion'));
});
