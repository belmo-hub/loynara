import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// G-26: each legal page lists its sections for „Inhalt“ beside the headings; the two must not drift apart.
describe.each(["src/app/datenschutz/page.tsx", "src/app/teilnahmebedingungen/page.tsx"])("legal contents of %s", (file) => {
  const source = readFileSync(file, "utf8");
  it("lists every section heading, in order, with its id and its exact wording", () => {
    const headings = [...source.matchAll(/<h2 id="([^"]+)">([^<]+)<\/h2>/g)].map(([, id, title]) => ({ id, title }));
    const listed = [...source.matchAll(/\{ id: "([^"]+)", title: "([^"]+)" \}/g)].map(([, id, title]) => ({ id, title }));
    expect(headings.length).toBeGreaterThan(3);
    expect(listed).toEqual(headings);
    expect(source).not.toMatch(/<h2>/);
  });
});
