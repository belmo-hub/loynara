import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import GlobalError from "./global-error";
import NotFound from "./not-found";
import { SystemState } from "@/components/ui/system-state";

const error = Object.assign(new Error("database password is hunter2"), { digest: "123456" });
const noop = () => undefined;

describe("system states", () => {
  it("global error renders a complete German document without external requests or error details", () => {
    const html = renderToStaticMarkup(h(GlobalError, { error, retry: noop }));
    expect(html).toMatch(/^<html lang="de">/);
    expect(html).not.toMatch(/https?:\/\/|<link|@import|url\(/);
    expect(html).not.toContain("hunter2");
    expect(html).toContain("Noch einmal versuchen");
    expect(html).toContain("123456");
  });

  it("the reference code links a prepared support mail and never the error message", () => {
    const html = renderToStaticMarkup(h(SystemState, { title: "Titel", reference: "abc" }));
    expect(html).toContain("mailto:support@getloynara.com?subject=Fehler%20auf%20Loynara%20(abc)");
    expect(renderToStaticMarkup(h(SystemState, { title: "Titel" }))).not.toContain("mailto:");
  });

  // Design, 12 Nov (sign 15): a tile stands above the title only on an error, the same tile as on a guest's screen.
  it("only an error carries a tile", () => {
    const tile = /<span class="[^"]*icon[^"]*" aria-hidden="true"><svg/;
    expect(renderToStaticMarkup(h(SystemState, { title: "Titel", error: true }))).toMatch(tile);
    expect(renderToStaticMarkup(h(SystemState, { title: "Titel" }))).not.toMatch(tile);
    expect(renderToStaticMarkup(h(NotFound))).not.toMatch(tile);
  });

  it("not found keeps its heading and offers card recovery before the business sign-in", () => {
    const html = renderToStaticMarkup(h(NotFound));
    expect(html).toContain("Diese Seite gibt es nicht.");
    const recover = html.indexOf('href="/recover"'), login = html.indexOf('href="/login"');
    expect(recover).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(-1);
    expect(recover).toBeLessThan(login);
  });

  it("no loading boundary sits above the root page or the sign-up redirect", () => {
    // A Suspense boundary there turns redirect("/login") into a 200 with a client-side redirect.
    expect(existsSync("src/app/loading.tsx")).toBe(false);
  });

  it("the owner area has no loading route: the screen in view stays until the next one is ready, then they change with the screen transition", () => {
    expect(existsSync("src/app/merchant/loading.tsx")).toBe(false);
  });
});

describe("route state files", () => {
  it("every loading, error and not-found file exports a default component", async () => {
    for (const file of ["cashier/loading", "error", "merchant/error", "cashier/error", "global-error", "not-found", "merchant/not-found"]) {
      const route = await import(`./${file}.tsx`);
      expect(typeof route.default, file).toBe("function");
    }
  });
});

// D-020 and Design's call 4 (12 Nov): this page loads no app CSS or fonts, so it is set in the system sans stack with
// the house weights and the house focus ring. Never a serif.
describe("global-error's own styles", () => {
  const source = readFileSync("src/app/global-error.tsx", "utf8");
  // 700, not 720: a system font outside the tokens, and static Segoe UI (Windows 10) would round 720 up to Black.
  it("has no serif, a title at 800 and a button at 700", () => {
    expect(source).not.toMatch(/Georgia|Times|[^-]serif/);
    expect(source).toContain('h1 { margin: 0; font: 800 1.75rem/1.15 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: -.025em;');
    expect(source).toContain('font: 700 1rem/1 system-ui, -apple-system, "Segoe UI", sans-serif;');
  });
  it("draws the focus ring as the app does: 2 px, 2 px off, in the focus colour of each theme", () => {
    expect(source).toContain("button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }");
    expect(source).toContain("--focus: #17291F;");
    expect(source).toContain("--focus: #E8ECEA;");
  });
});
