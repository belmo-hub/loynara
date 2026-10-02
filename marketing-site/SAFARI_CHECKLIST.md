# Manual Safari / iPhone checklist (no automated WebKit run exists for this candidate)

Local review URL (loopback only, this Mac): `http://127.0.0.1:8790/` — start with `PORT=8790 npm run marketing:preview`. To open it on an iPhone, the owner must decide how to expose the worktree on the local network; nothing was exposed or published by this task.

Run on macOS Safari (latest) and on a physical iPhone (Safari, portrait, then rotate once):

1. **Header:** scroll the page — the sticky header keeps a readable background (blurred where supported, solid otherwise); no flicker over the dark sections.
2. **Menu (≤1100 px / iPhone):** open, navigate, Escape or tap outside closes it; focus returns to "Menü".
3. **Fonts:** headline italic (Fraunces) and body (Manrope) render, no fallback font flash that shifts the layout.
4. **Demo:** returning card 8→9→10→redemption; new card 0→1; after every tap the next button is fully visible below the header and the sticky "Schritt x von 4" line; repeated taps never add a second stamp; "Neu starten ↺" stays on one line.
5. **Industry selector:** pills on desktop, select on iPhone; switching resets the demo.
6. **Moments:** three scenes; the outlook badge and "Versand ist nicht Teil des aktuellen Angebots" are visible; no scene reads as an active feature.
7. **Calculator:** type "12,75" in the basket field (iPhone decimal keyboard; comma and point both accepted); the caret does not jump; ranges respond to touch; invalid input shows an explanation and blanks the results; reset works; keyboard does not hide the edited field.
8. **Chart:** tap the plot — the readout strip above updates (it never covers the lines); the "+… € im Jahr" label at month 12 is readable; the data table scrolls.
9. **Request:** "E-Mail vorbereiten" opens Mail with subject/body and umlauts intact; "Text kopieren" copies or shows the fallback message; nothing is sent automatically.
10. **Reduced motion** (Settings → Accessibility → Motion): content fully visible, no fade/scroll animation.
11. **Print / PDF** (Safari → File → Print): all sections visible without scrolling first.
12. **Back from Impressum / Datenschutz:** no section stays hidden; scroll position restored.

Record: device model, iOS/macOS and Safari version, pass/fail per item, screenshots of any defect.
