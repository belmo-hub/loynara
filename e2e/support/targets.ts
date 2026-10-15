import type { Page } from "@playwright/test";

/**
 * One tap-target rule for every phone spec (DESIGN.md, "Touch targets"): each control is at least 44 × 44 px.
 * - A checkbox or radio, and a visually hidden input (file pickers), counts as its label.
 * - A positioned ::after counts as hit area only where the browser's own hit test lands on the control.
 * - Links inside a sentence are exempt (WCAG 2.5.8 inline exception): an inline <a> with running text right beside it
 *   in the same line. A neighbouring control, a line break or text elsewhere in the block does not make it inline.
 * `exempt` skips decorative previews that render scaled controls (for example the owner's wallet-pass mock).
 * Regression cases: e2e/targets-helper.mobile.spec.ts.
 */
export async function smallTargets(page: Page, options: { scope?: string; exempt?: string } = {}): Promise<string[]> {
  return page.evaluate(({ scope, exempt }) => {
    const MIN = 44;
    const CONTROL = "a[href], button, [role=button], summary, select, textarea, input:not([type=hidden])";
    const rendered = (el: Element) => {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return el.getClientRects().length > 0 && box.width > 0 && box.height > 0 && style.visibility !== "hidden"
        && !el.closest("[hidden], [inert], dialog:not([open])");
    };
    const inlineDisplay = (el: Element) => getComputedStyle(el).display === "inline";

    /** Running text directly before or after `node` in its line: stops at controls, line breaks and block edges. */
    const textBeside = (start: Node): boolean => {
      for (let node: Node = start; node.parentElement; node = node.parentElement) {
        for (const step of ["previousSibling", "nextSibling"] as const) {
          for (let sibling = node[step]; sibling; sibling = sibling[step]) {
            if (sibling.nodeType === Node.TEXT_NODE) { if (sibling.textContent!.trim()) return true; continue; }
            if (!(sibling instanceof Element)) continue;
            if (sibling.tagName === "BR" || !inlineDisplay(sibling) || sibling.matches(CONTROL) || sibling.querySelector(CONTROL)) break;
            if (sibling.textContent!.trim()) return true;
          }
        }
        if (!inlineDisplay(node.parentElement)) return false;
      }
      return false;
    };
    const inlineLink = (el: Element) => el.tagName === "A" && inlineDisplay(el) && textBeside(el);

    /** The element whose box is the target: a label for ticks and visually hidden inputs. */
    const targetOf = (el: HTMLElement): HTMLElement => {
      if (!(el instanceof HTMLInputElement)) return el;
      const box = el.getBoundingClientRect(), label = el.labels?.[0];
      const tick = el.type === "checkbox" || el.type === "radio";
      return label && (tick || box.width <= 2 || box.height <= 2) ? label : el;
    };

    /** Extra hit area from a positioned ::after, counted only where hit testing confirms it belongs to the control. */
    const hitArea = (target: HTMLElement) => {
      const box = target.getBoundingClientRect();
      let width = box.width, height = box.height;
      const after = getComputedStyle(target, "::after");
      if (after.content === "none" || after.position !== "absolute" || after.pointerEvents === "none" || getComputedStyle(target).position === "static") return { width, height };
      const claimedWidth = parseFloat(after.width), claimedHeight = parseFloat(after.height);
      const hits = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === target || target.contains(hit)));
      };
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      if (claimedWidth > width && hits(cx - claimedWidth / 2 + 1, cy) && hits(cx + claimedWidth / 2 - 1, cy)) width = claimedWidth;
      if (claimedHeight > height && hits(cx, cy - claimedHeight / 2 + 1) && hits(cx, cy + claimedHeight / 2 - 1)) height = claimedHeight;
      return { width, height };
    };

    const root = document.querySelector(scope) ?? document.body;
    return [...root.querySelectorAll<HTMLElement>(CONTROL)]
      .filter(el => !(exempt && el.closest(exempt)))
      .map(el => ({ el, target: targetOf(el) }))
      .filter(({ target }) => rendered(target))
      .filter(({ el }) => !inlineLink(el))
      .map(({ el, target }) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("name") ?? el.id ?? "").trim().slice(0, 40), ...hitArea(target) }))
      // Compared unrounded: 43.6 px is under the minimum. Only the message rounds.
      .filter(({ width, height }) => width < MIN || height < MIN)
      .map(({ name, width, height }) => `${name} ${Math.round(width * 10) / 10}x${Math.round(height * 10) / 10}`);
  }, { scope: options.scope ?? "body", exempt: options.exempt ?? "" });
}
