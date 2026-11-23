"use client";

import { CalendarDays, Euro, FileJson, FileText, LogOut, MapPin, Store, Users } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { billingStatus, type BillingOverview } from "@/components/owner/billing-copy";
import { useOwner } from "@/components/owner/owner-context";
import { MoreLabel, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { nf } from "@/components/owner/owner-ui";
import { usePasskeyRows } from "@/components/owner/passkey-rows";
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
  if (!me) return null;
  // Removing a passkey asks first, on its own screen, as Team does for a revoked access.
  if (passkeys.confirm) return passkeys.confirm;
  const team = staff.state === "ok" ? staff.data.staff.filter(person => person.active).length : null;
  return (
    <div className="ow-page">
      <PageTitle title={<MoreLabel />} />
      <div className="ow-prog">
        {/* Section heads, the Geschäft sub-line and „Konto“: copy-rest R13 FINAL. The sub-line names Programmende only where it is offered. */}
        {/* Booking surfaces only where the operator switched it on (Design, 22 Nov); other shops see the screen as before. */}
        {me.bookingShown && <Rows title="Termine"><Row key="termine" href="/merchant/termine" icon={CalendarDays} title="Termine" sub="Tagesansicht und Einrichtung der Online-Buchung" /></Rows>}
        {isOwner && <Rows title="Geschäft">
          <Row key="settings" href="/merchant/settings" icon={Store} title="Geschäft" sub={[...(senderOffered(owner.hiddenSurfaces) ? ["Absender"] : []), "Wochenbericht", ...(owner.hiddenSurfaces.includes("cancellation") ? [] : ["Programmende"])].join(", ")} />
          <Row key="locations" href="/merchant/locations" icon={MapPin} title="Standorte" value={owner.locations.length ? nf.format(owner.locations.length) : undefined} big />
          <Row key="staff" href="/merchant/staff" icon={Users} title="Team" value={team === null ? undefined : nf.format(team)} big />
          {billing && <Row key="billing" href="/merchant/billing" icon={Euro} title="Abrechnung" sub={plan.state === "ok" ? billingStatus(plan.data) : undefined} />}
        </Rows>}
        {/* The exports and their sentence moved here from the invite card (live strings). */}
        {isOwner && <Rows title="Daten" note={me.bookingShown ? "Lade deine Karten und Buchungen für Excel herunter. Karten und Buchungen enthalten keine Kontaktdaten; der Termin-Export enthält Name und Telefon, so wie Kundinnen und Kunden sie beim Buchen angegeben haben." : "Lade deine Karten und Buchungen für Excel herunter. Kontaktdaten deiner Kundinnen und Kunden sind nicht enthalten."}>
          <Row key="cards" href={`${EXPORT}?format=karten`} download icon={FileText} title="Karten für Excel" sub="Eine Zeile pro Karte mit aktuellem Stand." />
          <Row key="bookings" href={`${EXPORT}?format=buchungen`} download icon={FileText} title="Buchungen für Excel" sub="Jeder Stempel, jede Einlösung und jede Korrektur mit Datum und Standort." />
          {me.bookingShown && <Row key="appointments" href={`${EXPORT}?format=appointments`} download icon={FileText} title="Termine für Excel" sub="Jeder Termin mit Kunde, Telefon und Status. Die Telefonnummern stehen nur hier." />}
          <Row key="json" href={EXPORT} download icon={FileJson} title="Vollständiger Export (JSON)" />
        </Rows>}
        <Rows title="Konto" note={passkeys.note?.text} noteTone={passkeys.note?.tone}>
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
