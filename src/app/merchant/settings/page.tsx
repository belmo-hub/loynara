"use client";

import Link from "next/link";
import { PrivacySettings } from "@/components/owner/privacy-settings";
import { useState, type FormEvent } from "react";
import { postJson } from "@/components/client-api";
import { JoinCard } from "@/components/owner/join-card";
import { useDirtyGuard, useOwner, type OwnerLocation } from "@/components/owner/owner-context";
import { locationAddressMessage } from "@/components/owner/owner-errors";
import { Notice, SaveBar, type SaveState } from "@/components/owner/owner-ui";

export default function MerchantSettingsPage() {
  const { me, locations, hiddenSurfaces } = useOwner();
  if (!me) return null;
  if (me.role !== "owner") return <div className="ow-page"><Notice tone="warn">Die Einstellungen sind Inhaber:innen vorbehalten.</Notice></div>;
  const location = locations.find(row => row.id === me.locationId);
  return (
    <div className="ow-page">
      <header className="ow-pagehead"><div><p className="ow-eyebrow">Einstellungen</p><h1>Geschäft</h1><p>Name, Anschrift, Standort und Zugang für deine Kunden.</p></div></header>
      <div className="ow-two">
        <div className="ow-stack">
          <section className="ow-card ow-stack" aria-labelledby="ow-biz-title">
            <h2 id="ow-biz-title">Dein Geschäft</h2>
            <dl className="ow-dl">
              <dt>Geschäft</dt><dd>{me.businessName}</dd>
              <dt>Aktiver Standort</dt><dd>{me.locationName}</dd>
              <dt>Standorte</dt><dd>{locations.length || 1}</dd>
              <dt>Programm</dt><dd>{me.programType === "stamp" ? "Stempelkarte" : "Punktekarte"}</dd>
            </dl>
            <div className="ow-row">
              <Link className="ow-btn ow-btn--secondary ow-btn--sm" href="/merchant/program/card">{hiddenSurfaces.includes("cardLogo") ? "Name und Farbe ändern" : "Name, Farbe und Logo ändern"}</Link>
              <Link className="ow-btn ow-btn--ghost ow-btn--sm" href="/merchant/locations">Standorte verwalten</Link>
            </div>
          </section>
          {location && <AddressCard key={location.id} location={location} />}
        </div>
        <JoinCard me={me} exportUrl="/api/merchant/export" />
      </div>
      <PrivacySettings tenantId={me.tenantId} businessName={me.businessName} />
    </div>
  );
}

function AddressCard({ location }: { location: OwnerLocation }) {
  const owner = useOwner();
  const initial = {
    street: location.street ?? "", postalCode: location.postalCode ?? "", city: location.city, representative: location.representative ?? "",
    contactEmail: location.contactEmail ?? "", contactPhone: location.contactPhone ?? "", legalForm: location.legalForm ?? "",
    registerCourt: location.registerCourt ?? "", registerNumber: location.registerNumber ?? "", vatId: location.vatId ?? "",
  };
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("location-address", changed);
  const edit = (patch: Partial<typeof draft>) => { setDraft(current => ({ ...current, ...patch })); if (state === "saved" || state === "error") { setState("clean"); setError(""); } };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving") return;
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/locations/address", { locationId: location.id, ...draft });
      setSaved(draft); setState("saved");
      void owner.refresh(); // keeps the location list current, so this form shows the saved address after a remount
    } catch (cause) { setState("error"); setError(locationAddressMessage(cause)); }
  }
  return (
    <section className="ow-card ow-stack" id="anschrift" aria-labelledby="ow-address-title">
      <div><h2 id="ow-address-title">Anschrift</h2><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Steht als Absender unter jeder E-Mail an deine Kundschaft. Solange eine Pflichtangabe fehlt, verschickt Loynara keine Erinnerungen und Kampagnen.</p></div>
      <form onSubmit={submit} className="ow-stack">
        <div className="ow-field"><label htmlFor="ad-street">Straße und Hausnummer</label><input id="ad-street" className="ow-input" autoComplete="street-address" value={draft.street} minLength={2} maxLength={180} required onChange={event => edit({ street: event.target.value })} /></div>
        <div className="ow-grid-2">
          <div className="ow-field"><label htmlFor="ad-postal">PLZ</label><input id="ad-postal" className="ow-input" inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{5}" title="Fünf Ziffern" maxLength={5} value={draft.postalCode} required onChange={event => edit({ postalCode: event.target.value })} /></div>
          <div className="ow-field"><label htmlFor="ad-city">Stadt</label><input id="ad-city" className="ow-input" autoComplete="address-level2" value={draft.city} minLength={2} maxLength={120} required onChange={event => edit({ city: event.target.value })} /></div>
        </div>
        <div className="ow-field"><label htmlFor="ad-representative">Vertreten durch (Inhaber:in oder Geschäftsführer:in)</label><input id="ad-representative" className="ow-input" autoComplete="name" value={draft.representative} minLength={2} maxLength={120} required aria-describedby="ad-business-hint" onChange={event => edit({ representative: event.target.value })} /><p id="ad-business-hint" className="ow-hint">Vertretung, Rechtsform, Register und USt-IdNr. gelten für dein ganzes Geschäft, an allen Standorten.</p></div>
        <fieldset className="ow-group">
          <legend>Kontakt: E-Mail oder Telefon, mindestens eins</legend>
          <div className="ow-grid-2">
            <div className="ow-field"><label htmlFor="ad-email">Kontakt-E-Mail</label><input id="ad-email" className="ow-input" type="email" autoComplete="email" value={draft.contactEmail} maxLength={320} required={!draft.contactPhone.trim()} onChange={event => edit({ contactEmail: event.target.value })} /></div>
            <div className="ow-field"><label htmlFor="ad-phone">Telefon</label><input id="ad-phone" className="ow-input" type="tel" autoComplete="tel" value={draft.contactPhone} maxLength={30} required={!draft.contactEmail.trim()} onChange={event => edit({ contactPhone: event.target.value })} /></div>
          </div>
        </fieldset>
        <fieldset className="ow-group">
          <legend>Nur wenn vorhanden</legend>
          <div className="ow-field"><label htmlFor="ad-legal-form">Rechtsform</label><input id="ad-legal-form" className="ow-input" placeholder="z. B. GmbH, UG (haftungsbeschränkt), e.K." value={draft.legalForm} minLength={2} maxLength={40} onChange={event => edit({ legalForm: event.target.value })} /></div>
          <div className="ow-grid-2">
            <div className="ow-field"><label htmlFor="ad-register-court">Registergericht</label><input id="ad-register-court" className="ow-input" placeholder="z. B. Amtsgericht Kassel" value={draft.registerCourt} minLength={2} maxLength={120} required={Boolean(draft.registerNumber.trim())} onChange={event => edit({ registerCourt: event.target.value })} /></div>
            <div className="ow-field"><label htmlFor="ad-register-number">Registernummer</label><input id="ad-register-number" className="ow-input" placeholder="z. B. HRB 12345" title="Registerart und Nummer, z. B. HRB 12345 oder HRA 7" pattern="(HRA|HRB|GnR|GsR|PR|VR) ?[0-9]{1,6}( ?[A-Z]{1,2})?" value={draft.registerNumber} minLength={2} maxLength={40} required={Boolean(draft.registerCourt.trim())} onChange={event => edit({ registerNumber: event.target.value })} /></div>
          </div>
          <div className="ow-field"><label htmlFor="ad-vat">USt-IdNr.</label><input id="ad-vat" className="ow-input" placeholder="z. B. DE123456789" autoCapitalize="characters" value={draft.vatId} maxLength={20} onChange={event => edit({ vatId: event.target.value })} /></div>
          <p className="ow-hint">Leere Felder erscheinen nicht in der E-Mail.</p>
        </fieldset>
        <SaveBar asSubmit state={shown} onDiscard={() => { setDraft(saved); setState("clean"); setError(""); }} canSave={changed} saveLabel="Anschrift speichern" detail={shown === "error" ? `${error} Deine Eingaben sind noch da.` : undefined} />
      </form>
    </section>
  );
}
