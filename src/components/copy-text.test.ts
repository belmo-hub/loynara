import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyLabel, copyText } from "./copy-text";

function fakeDocument(execResult: boolean | "throw") {
  const field = { value: "", readOnly: false, style: { cssText: "" }, select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
  const document = {
    createElement: vi.fn(() => field),
    body: { append: vi.fn() },
    execCommand: vi.fn(() => { if (execResult === "throw") throw new Error("not allowed"); return execResult; }),
  };
  vi.stubGlobal("document", document);
  return { document, field };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("copyText", () => {
  it("uses the Clipboard API and buzzes where the phone can", async () => {
    const writeText = vi.fn(async () => {}), vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { clipboard: { writeText }, vibrate });
    const { document } = fakeDocument(true);
    expect(await copyText("https://example.test/join/a")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.test/join/a");
    expect(vibrate).toHaveBeenCalledOnce();
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("falls back to a selected field when the Clipboard API is missing (older iOS Safari, in-app browsers)", async () => {
    vi.stubGlobal("navigator", {}); // no clipboard, no vibrate: iOS Safari has none
    const { document, field } = fakeDocument(true);
    expect(await copyText("abc")).toBe(true);
    expect(field.value).toBe("abc");
    expect(field.setSelectionRange).toHaveBeenCalledWith(0, 3);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(field.remove).toHaveBeenCalledOnce();
  });

  it("falls back when the Clipboard API refuses, and reports failure instead of throwing", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("NotAllowedError"); }) } });
    const refused = fakeDocument(false);
    expect(await copyText("abc")).toBe(false);
    expect(refused.field.remove).toHaveBeenCalledOnce();
    fakeDocument("throw");
    expect(await copyText("abc")).toBe(false);
  });
});

describe("CopyLabel", () => {
  it("keeps both words in one cell, so the button keeps its width, and only the shown one is read out", () => {
    const idle = renderToStaticMarkup(createElement(CopyLabel, { copied: false, label: "Link kopieren" }));
    expect(idle).toContain("display:inline-grid");
    expect(idle).toMatch(/<span style="grid-area:1 \/ 1">Link kopieren<\/span><span style="grid-area:1 \/ 1;visibility:hidden" aria-hidden="true">Kopiert<\/span>/);
    const done = renderToStaticMarkup(createElement(CopyLabel, { copied: true, label: "Link kopieren" }));
    expect(done).toMatch(/visibility:hidden" aria-hidden="true">Link kopieren<\/span><span style="grid-area:1 \/ 1">Kopiert<\/span>/);
  });
});
