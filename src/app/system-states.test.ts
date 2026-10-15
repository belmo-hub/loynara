import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "./global-error";
import NotFound from "./not-found";
import { PageLoading, SystemState } from "@/components/ui/system-state";

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

  it("not found keeps its heading and offers card recovery before the business sign-in", () => {
    const html = renderToStaticMarkup(h(NotFound));
    expect(html).toContain("Diese Seite gibt es nicht.");
    expect(html.indexOf('href="/recover"')).toBeLessThan(html.indexOf('href="/login"'));
  });

  it("loading placeholders are busy regions with a spoken label", () => {
    for (const variant of ["column", "dashboard"] as const) {
      const html = renderToStaticMarkup(h(PageLoading, { variant }));
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("Seite wird geladen");
      expect(html).not.toContain('role="status"');
    }
  });
});
