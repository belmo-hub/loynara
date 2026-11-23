/**
 * A tap outside an open `popover="auto"` only closes it. The browser light-dismisses the popover on that tap and then
 * still delivers it, as a click, to whatever lies under it: over the Kasse that was „1 Stempel vergeben“, a booking
 * (ENG-374). Use as the popover's ref: while it is open, a pointer pressed down outside it and outside its own buttons
 * cancels the click of that same press. Mouse, touch and pen all send pointer events; a keyboard „click“ (detail 0) is
 * never cancelled, and the next press or key decides afresh. A cancelled gesture (a scroll, a palm) disarms it too, so a
 * later synthetic click, as a screen reader sends one, is never swallowed.
 */
export function swallowClosingTap(popover: HTMLElement | null) {
  if (!popover) return;
  const doc = popover.ownerDocument;
  let armed = false;
  const down = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    armed = popover.matches(":popover-open") && !!target && !popover.contains(target) && !target.closest(`[popovertarget="${popover.id}"]`);
  };
  const click = (event: MouseEvent) => {
    if (!armed || event.detail === 0) return;
    armed = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const disarm = () => { armed = false; };
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("click", click, true);
  doc.addEventListener("keydown", disarm, true);
  doc.addEventListener("pointercancel", disarm, true);
  return () => {
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("click", click, true);
    doc.removeEventListener("keydown", disarm, true);
    doc.removeEventListener("pointercancel", disarm, true);
  };
}
