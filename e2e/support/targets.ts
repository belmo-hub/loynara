import type { Page } from "@playwright/test";

/**
 * One tap-target rule for every phone spec (DESIGN.md, "Touch targets"): each control is at least 44 × 44 px.
 * A checkbox or radio counts as its label. A ::after overlay that is positioned outside the box counts as hit area.
 * Links inside a sentence are exempt (WCAG 2.5.8 inline exception): an inline <a> whose block also holds other text.
 * `exempt` skips decorative previews that render scaled controls (for example the owner's wallet-pass mock).
 */
export async function smallTargets(page: Page, options: { scope?: string; exempt?: string } = {}): Promise<string[]> {
  return page.evaluate(({ scope, exempt }) => {
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return box.width > 2 && box.height > 2 && style.visibility !== "hidden" && !el.closest("[hidden], [inert], dialog:not([open])");
    };
    const blockOf = (el: Element) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const display = getComputedStyle(node).display;
        if (!display.startsWith("inline") && display !== "contents") return node;
      }
      return document.body;
    };
    const inlineLink = (el: Element) => el.tagName === "A" && getComputedStyle(el).display === "inline"
      && (blockOf(el).textContent ?? "").replace(el.textContent ?? "", "").trim().length > 0;
    const root = document.querySelector(scope) ?? document.body;
    return [...root.querySelectorAll<HTMLElement>("a[href], button, [role=button], summary, select, textarea, input:not([type=hidden])")]
      .filter(el => visible(el) && !(exempt && el.closest(exempt)) && !inlineLink(el))
      .map(el => {
        const tick = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
        const target = tick && el.closest("label") ? el.closest("label")! : el;
        const box = target.getBoundingClientRect(), after = getComputedStyle(target, "::after");
        let width = box.width, height = box.height;
        if (after.content !== "none" && after.position === "absolute") {
          width = Math.max(width, box.width - (parseFloat(after.left) || 0) - (parseFloat(after.right) || 0));
          height = Math.max(height, box.height - (parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0));
        }
        return { name: (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("name") ?? el.id ?? "").trim().slice(0, 40), width, height };
      })
      .filter(({ width, height }) => Math.round(width) < 44 || Math.round(height) < 44)
      .map(({ name, width, height }) => `${name} ${Math.round(width)}x${Math.round(height)}`);
  }, { scope: options.scope ?? "body", exempt: options.exempt ?? "" });
}
