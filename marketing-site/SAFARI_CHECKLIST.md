# Manual Safari / iPhone checklist (compact-v3) – no automated WebKit or physical-device run exists for this candidate

Local review URL (loopback only, this Mac): `http://127.0.0.1:8791/` — start with `PORT=8791 npm run marketing:preview` from the worktree root. To open it on an iPhone, the owner must decide how to expose the worktree on the local network; nothing was exposed or published by this task.

Run on macOS Safari (latest) and on a physical iPhone (Safari, portrait, then rotate once):

1. **Header and menu:** scroll – the sticky header keeps a readable background; the menu opens, navigates and closes (Escape or tap outside); focus returns to "Menü".
2. **Fonts:** headline italic (Fraunces) and body (Manrope) render; no layout shift after fonts load.
3. **Hero:** headline, supporting sentence, small stand, flow line and the paper → digital strip are readable at 320–430 px; nothing overlaps.
4. **Journey (Starten · Sammeln · Belohnen · Empfehlen):** the tabs are tappable (≥ 44 px) and keep focus; returning card 8 → 9 → 10 → Einlösung; new card 0 → 1; after every tap the next button is fully visible below the header; repeated taps never add a second stamp; switching chapters never records an event; "Neu starten ↺" stays on one line. On the phone only one panel is expanded.
5. **Empfehlen:** Link teilen → Freund öffnet → Karte erstellen → Besuch bestätigen; the bonus appears only after the last step and only once.
6. **Industry selector:** pills on desktop, select on iPhone; switching shows the restart note and keeps the calculator values.
7. **Inhaber-Bereich:** Überblick · Ruhige Zeiten · Zurückholen; the "Plattform-Ausblick – nicht im aktuellen Pilotangebot" label is visible; message previews are labelled and nothing is sent.
8. **Gestaltung:** five colours, three logos, three reward options update stand, browser card and Wallet-Vorschau together; the "Gestaltungsbeispiel" label and the preview note are visible; there is no "Zum Wallet hinzufügen" control.
9. **Calculator:** type "12,75" in the basket field (decimal keyboard; comma and point both accepted); the caret does not jump; ranges respond to touch; invalid input explains itself and blanks the results; reset works; the keyboard does not hide the edited field.
10. **Chart:** tap the plot – the readout strip above updates (never covers the lines); the "+… € Zusatzumsatz" label at month 12 is readable; the data table scrolls.
11. **Angebot and FAQ:** current offer and outlook are visibly separated; FAQ disclosures open and close.
12. **Request:** "E-Mail vorbereiten" opens Mail with subject/body and umlauts intact; "Text kopieren" copies or shows the fallback message; nothing is sent automatically.
13. **Reduced motion** (Settings → Accessibility → Motion): content fully visible, no fade/scroll animation.
14. **Print / PDF** (Safari → File → Print): all sections and all three owner views/chapters' content are readable without scrolling first.
15. **Back from Impressum / Datenschutz:** no section stays hidden; scroll position restored. Also rotate once and increase text size (Settings → Display → Text Size) and re-check items 3–4 and 9.

Record: device model, iOS/macOS and Safari version, pass/fail per item, screenshots of any defect.
