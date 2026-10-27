import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveBar } from "./owner-ui";

describe("SaveBar", () => {
  it("names its card while unsaved, so pinned bars from different cards can be told apart", () => {
    expect(renderToStaticMarkup(createElement(SaveBar, { state: "dirty", section: "Happy Hour", onSave: () => {} }))).toContain("Ungespeicherte Änderungen: Happy Hour");
    expect(renderToStaticMarkup(createElement(SaveBar, { state: "dirty", onSave: () => {} }))).toContain("Ungespeicherte Änderungen<");
    expect(renderToStaticMarkup(createElement(SaveBar, { state: "clean", section: "Happy Hour", onSave: () => {} }))).toContain("Keine Änderungen");
    expect(renderToStaticMarkup(createElement(SaveBar, { state: "saved", section: "Happy Hour", onSave: () => {} }))).not.toContain("Happy Hour");
  });
});
