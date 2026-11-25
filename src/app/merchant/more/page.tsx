"use client";

import { Euro, FileJson, FileText, LockKeyhole, LogOut, MapPin, Store, Users } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { billingStatus, type BillingOverview } from "@/components/owner/billing-copy";
import { useOwner } from "@/components/owner/owner-context";
import { MoreLabel, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { nf } from "@/components/owner/owner-ui";
import { usePasskeyRows } from "@/components/owner/passkey-rows";
import { MORE_HOME, PASSWORD_PATH } from "@/components/owner/password-question";
import { readReturn, writeReturn } from "@/components/owner/program-list";
import { useLoad } from "@/components/owner/use-load";
import { senderOffered } from "@/components/owner/sender";

const EXPORT = "/api/merchant/export";

/** „Mehr“ (ENG-122c, screen 12): the phone's last tab and the desktop's Einstellungen, one row per page; values from the existing reads. */
export default function MorePage() {
  const owner = useOwner();
  const me = owner.me;
  const isOwner = me?.role === "owner";
  const billing = isOwner && !owner.hiddenSurfaces.includes("billing");
  const [staff] = useLoad<{ staff: Array<{ active: boolean }> }>(isOwner ? "/api/staff" : null);
  const [plan] = useLoad<BillingOverview>(billing ? "/api/merchant/billing" : null);
  const passkeys = usePasskeyRows();
  // Back from „Passwort ändern“: its row outlined and the outcome under Konto, once (Design rule 10).
  const [back] = useState(() => readReturn(MORE_HOME.list));
  useEffect(() => { writeReturn(null, MORE_HOME.list); }, []);
  // The outcome sits far down on a phone: bring it into view above the tab bar, then focus the row, as Programm's return
  // does. First the moment it renders, before the first paint, so the screen change goes straight into Konto: in a
  // microtask, after the shell's own scroll to the top in the same commit. Then it is held there, on every frame and every
  // scroll, until Mehr has settled (the reads give Konto its height), the fonts are in and the screen change is over: in
  // WebKit an older offset comes back about 95 ms into the change, under the tab bar (Design r2–r4). `block: "nearest"`
  // leaves a note already in view alone.
  const settled = Boolean(me) && staff.state !== "loading" && plan.state !== "loading" && passkeys.ready;
  const calm = useRef(false), held = useRef(false);
  useLayoutEffect(() => { calm.current = settled; }, [settled]);
  useLayoutEffect(() => {
    if (held.current || !me || !back?.saved) return;
    let alive = true; // cleared on leaving: a quick tap away leaves the next screen alone
    const note = () => { if (alive) document.querySelector(".ow-prog-outcome")?.scrollIntoView({ block: "nearest", behavior: "instant" }); };
    // The owner's own input ends the hold and its row focus at once: it must not fight their scrolling, and a VoiceOver
    // swipe moves focus (focusin). The shell's own focus on the content after the change is not theirs. Added here, after
    // the save tap; WebKit's late offset comes without input (Reviewer, Design r5).
    const INPUT = ["wheel", "touchstart", "pointerdown", "keydown", "focusin"] as const;
    const options = { capture: true, passive: true };
    const stop = () => { window.removeEventListener("scroll", note); for (const type of INPUT) window.removeEventListener(type, yielded, options); };
    const yielded = (event: Event) => {
      if (event.type === "focusin" && (event.target === document.body || (event.target as Element).matches?.("main"))) return;
      alive = false; held.current = true; stop();
    };
    queueMicrotask(note);
    window.addEventListener("scroll", note, { passive: true });
    for (const type of INPUT) window.addEventListener(type, yielded, options);
    let fonts = false;
    void document.fonts.ready.then(() => { fonts = true; });
    const started = performance.now();
    let seen = false;
    const frame = () => {
      if (!alive) return;
      const changing = Boolean((document as Document & { activeViewTransition?: unknown }).activeViewTransition);
      seen ||= changing;
      note();
      // Done once settled and the change has run (or none came, as with reduced motion); never past 3 s.
      const done = calm.current && fonts && !changing && (seen || performance.now() - started > 400);
      if (!done && performance.now() - started < 3000) { requestAnimationFrame(frame); return; }
      held.current = true;
      stop();
      // Only where focus has not gone anywhere of the owner's choosing.
      if (document.activeElement === document.body || document.activeElement?.matches("main")) Array.from(document.querySelectorAll<HTMLElement>(".ow-content a")).find(link => link.getAttribute("href") === back.row)?.focus({ preventScroll: true });
    };
    requestAnimationFrame(frame);
    return () => { alive = false; stop(); };
  }, [me, back]);
  if (!me) return null;
  // Removing a passkey asks first, on its own screen, as Team does for a revoked access.
  if (passkeys.confirm) return passkeys.confirm;
  const team = staff.state === "ok" ? staff.data.staff.filter(person => person.active).length : null;
  return (
    <div className="ow-page">
      <PageTitle title={<MoreLabel />} />
      <div className="ow-prog">
        {/* Section heads, the Geschäft sub-line and „Konto“: copy-rest R13 FINAL. The sub-line names Programmende only where it is offered. */}
        {isOwner && <Rows title="Geschäft">
          <Row key="settings" href="/merchant/settings" icon={Store} title="Geschäft" sub={[...(senderOffered(owner.hiddenSurfaces) ? ["Absender"] : []), "Wochenbericht", ...(owner.hiddenSurfaces.includes("cancellation") ? [] : ["Programmende"])].join(", ")} />
          <Row key="locations" href="/merchant/locations" icon={MapPin} title="Standorte" value={owner.locations.length ? nf.format(owner.locations.length) : undefined} big />
          <Row key="staff" href="/merchant/staff" icon={Users} title="Team" value={team === null ? undefined : nf.format(team)} big />
          {billing && <Row key="billing" href="/merchant/billing" icon={Euro} title="Abrechnung" sub={plan.state === "ok" ? billingStatus(plan.data) : undefined} />}
        </Rows>}
        {/* The exports and their sentence moved here from the invite card (live strings). */}
        {isOwner && <Rows title="Daten" note="Lade deine Karten und Buchungen für Excel herunter. Kontaktdaten deiner Kundinnen und Kunden sind nicht enthalten.">
          <Row key="cards" href={`${EXPORT}?format=karten`} download icon={FileText} title="Karten für Excel" sub="Eine Zeile pro Karte mit aktuellem Stand." />
          <Row key="bookings" href={`${EXPORT}?format=buchungen`} download icon={FileText} title="Buchungen für Excel" sub="Jeder Stempel, jede Einlösung und jede Korrektur mit Datum und Standort." />
          <Row key="json" href={EXPORT} download icon={FileJson} title="Vollständiger Export (JSON)" />
        </Rows>}
        <Rows title="Konto" note={passkeys.note?.text ?? (back?.saved ? back.toast : undefined)} noteTone={passkeys.note?.tone ?? (back?.saved ? "ok" : undefined)}>
          <Row key="password" href={PASSWORD_PATH} icon={LockKeyhole} title="Passwort ändern" saved={Boolean(back?.saved && back.row === PASSWORD_PATH)} />
          {passkeys.rows}
          <LogoutButton key="logout" className="ow-prog-row" onSignedOut={owner.resetAfterSignOut}>{label => <>
            <span className="ow-prog-icon"><LogOut size={22} aria-hidden="true" /></span>
            <span className="ow-prog-main"><span className="ow-prog-text"><strong>{label}</strong></span></span>
          </>}</LogoutButton>
        </Rows>
      </div>
    </div>
  );
}
