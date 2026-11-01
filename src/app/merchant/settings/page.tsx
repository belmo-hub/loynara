"use client";

import { MapPin, Palette } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postJson } from "@/components/client-api";
import { CancellationNotice } from "@/components/owner/cancellation-notice";
import { MORE_HREF } from "@/components/owner/nav";
import { useDirtyGuard, useOwner, type OwnerLocation } from "@/components/owner/owner-context";
import { locationAddressMessage } from "@/components/owner/owner-errors";
import { MoreLabel, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { GuardedLink } from "@/components/owner/owner-shell";
import { ErrorNotice, Notice, SaveBar, type SaveState } from "@/components/owner/owner-ui";
import { FieldError, SwitchRow } from "@/components/owner/question-form";
import { useLoad } from "@/components/owner/use-load";
import { useFormCheck } from "@/components/ui/form-check";

/** Geschäft (ENG-122c, screen 13): the card's names, the active location, the weekly report, and „Programm beenden“ last. */
export default function MerchantSettingsPage() {
  const { me, locations, hiddenSurfaces } = useOwner();
  if (!me) return null;
  const head = <PageTitle back={{ href: MORE_HREF, label: <MoreLabel /> }} title="Geschäft" lead="Name, Standort und Zugang für deine Kunden." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn">Die Einstellungen sind Inhaber:innen vorbehalten.</Notice></div>;
  const location = locations.find(row => row.id === me.locationId);
  const programName = location?.programName;
  return (
    <div className="ow-page">
      {head}
      <CancellationNotice me={me} />
      <div className="ow-prog">
        <Rows title="Dein Geschäft">
          {/* R14; where the logo upload is withheld the row promises no logo (W38's rule). */}
          <Row key="card" href="/merchant/program/card" icon={Palette} title={hiddenSurfaces.includes("cardLogo") ? "Name und Farbe" : "Name, Logo und Farbe"} sub={programName ? `${me.businessName} · ${programName}` : me.businessName} />
          <Row key="location" href="/merchant/locations" icon={MapPin} title="Aktiver Standort" value={me.locationName} off />
        </Rows>
        <Rows title="E-Mail"><WeeklyReport key="weekly" /></Rows>
        {/* Sender details for marketing mail (ENG-164): the automations and campaign notices link here. */}
        {location && <AddressCard key={location.id} location={location} />}
      </div>
      {/* The request is withheld on production until Legal's gate (pilot surfaces); a requested end shows as the notice above. */}
      {!hiddenSurfaces.includes("cancellation") && !me.cancellationEndDate && <div><GuardedLink href="/merchant/settings/cancel" className="ow-qlink" data-danger="">Programm beenden</GuardedLink></div>}
    </div>
  );
}

// Deliberately not a pilot surface: it only controls owner mail and must stay reachable on production. Saves on the switch.
function WeeklyReport() {
  const [setting, reload] = useLoad<{ enabled: boolean }>("/api/merchant/weekly-report");
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const enabled = saved ?? (setting.state === "ok" ? setting.data.enabled : null);
  async function change(next: boolean) {
    setSaving(true); setError("");
    try { setSaved((await postJson<{ enabled: boolean }>("/api/merchant/weekly-report", { enabled: next })).enabled); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen."); }
    finally { setSaving(false); }
  }
  if (setting.state === "error") return <ErrorNotice message={setting.message} onRetry={reload} />;
  return <>
    <SwitchRow label="Wochenbericht per E-Mail senden" sub="Jeden Montag um 7 Uhr eine E-Mail mit Buchungen, neuen Karten, Stammkunden, zurückgewonnenen Kunden und eingelösten Prämien der Vorwoche." checked={enabled ?? false} disabled={enabled === null || saving} onChange={change} />
    {error && <Notice tone="danger">{error}</Notice>}
  </>;
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
  const fields = useFormCheck({
    "ad-street": "Bitte gib Straße und Hausnummer ein.", "ad-postal": "Bitte gib die fünfstellige PLZ ein.", "ad-city": "Bitte gib die Stadt ein.",
    "ad-representative": "Bitte gib an, wer dein Geschäft vertritt.", "ad-email": "Bitte gib eine Kontakt-E-Mail oder eine Telefonnummer ein.",
    "ad-phone": "Bitte gib eine Telefonnummer oder eine Kontakt-E-Mail ein.",
  });
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("location-address", changed);
  const edit = (patch: Partial<typeof draft>) => { setDraft(current => ({ ...current, ...patch })); if (state === "saved" || state === "error") { setState("clean"); setError(""); } };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving" || !fields.check(event.currentTarget)) return;
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
      <form onSubmit={submit} onInput={fields.onInput} className="ow-stack" noValidate>
        <div className="ow-field"><label htmlFor="ad-street">Straße und Hausnummer</label><input id="ad-street" {...fields.aria("ad-street")} className="ow-input" autoComplete="street-address" value={draft.street} minLength={2} maxLength={180} required onChange={event => edit({ street: event.target.value })} /><FieldError id="ad-street-error">{fields.error("ad-street") ?? ""}</FieldError></div>
        <div className="ow-grid-2">
          <div className="ow-field"><label htmlFor="ad-postal">PLZ</label><input id="ad-postal" {...fields.aria("ad-postal")} className="ow-input" inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{5}" title="Fünf Ziffern" maxLength={5} value={draft.postalCode} required onChange={event => edit({ postalCode: event.target.value })} /><FieldError id="ad-postal-error">{fields.error("ad-postal") ?? ""}</FieldError></div>
          <div className="ow-field"><label htmlFor="ad-city">Stadt</label><input id="ad-city" {...fields.aria("ad-city")} className="ow-input" autoComplete="address-level2" value={draft.city} minLength={2} maxLength={120} required onChange={event => edit({ city: event.target.value })} /><FieldError id="ad-city-error">{fields.error("ad-city") ?? ""}</FieldError></div>
        </div>
        <div className="ow-field"><label htmlFor="ad-representative">Vertreten durch (Inhaber:in oder Geschäftsführer:in)</label><input id="ad-representative" {...fields.aria("ad-representative")} className="ow-input" autoComplete="name" value={draft.representative} minLength={2} maxLength={120} required aria-describedby="ad-business-hint" onChange={event => edit({ representative: event.target.value })} /><FieldError id="ad-representative-error">{fields.error("ad-representative") ?? ""}</FieldError><p id="ad-business-hint" className="ow-hint">Vertretung, Rechtsform, Register und USt-IdNr. gelten für dein ganzes Geschäft, an allen Standorten.</p></div>
        <fieldset className="ow-group">
          <legend>Kontakt: E-Mail oder Telefon, mindestens eins</legend>
          <div className="ow-grid-2">
            <div className="ow-field"><label htmlFor="ad-email">Kontakt-E-Mail</label><input id="ad-email" {...fields.aria("ad-email")} className="ow-input" type="email" autoComplete="email" value={draft.contactEmail} maxLength={320} required={!draft.contactPhone.trim()} onChange={event => edit({ contactEmail: event.target.value })} /><FieldError id="ad-email-error">{fields.error("ad-email") ?? ""}</FieldError></div>
            <div className="ow-field"><label htmlFor="ad-phone">Telefon</label><input id="ad-phone" {...fields.aria("ad-phone")} className="ow-input" type="tel" autoComplete="tel" value={draft.contactPhone} maxLength={30} required={!draft.contactEmail.trim()} onChange={event => edit({ contactPhone: event.target.value })} /><FieldError id="ad-phone-error">{fields.error("ad-phone") ?? ""}</FieldError></div>
          </div>
        </fieldset>
        <fieldset className="ow-group">
          <legend>Nur wenn vorhanden</legend>
          <div className="ow-field"><label htmlFor="ad-legal-form">Rechtsform</label><input id="ad-legal-form" {...fields.aria("ad-legal-form")} className="ow-input" placeholder="z. B. GmbH, UG (haftungsbeschränkt), e.K." value={draft.legalForm} minLength={2} maxLength={40} onChange={event => edit({ legalForm: event.target.value })} /><FieldError id="ad-legal-form-error">{fields.error("ad-legal-form") ?? ""}</FieldError></div>
          <div className="ow-grid-2">
            <div className="ow-field"><label htmlFor="ad-register-court">Registergericht</label><input id="ad-register-court" {...fields.aria("ad-register-court")} className="ow-input" placeholder="z. B. Amtsgericht Kassel" value={draft.registerCourt} minLength={2} maxLength={120} required={Boolean(draft.registerNumber.trim())} onChange={event => edit({ registerCourt: event.target.value })} /><FieldError id="ad-register-court-error">{fields.error("ad-register-court") ?? ""}</FieldError></div>
            <div className="ow-field"><label htmlFor="ad-register-number">Registernummer</label><input id="ad-register-number" {...fields.aria("ad-register-number")} className="ow-input" placeholder="z. B. HRB 12345" title="Registerart und Nummer, z. B. HRB 12345 oder HRA 7" pattern="(HRA|HRB|GnR|GsR|PR|VR) ?[0-9]{1,6}( ?[A-Z]{1,2})?" value={draft.registerNumber} minLength={2} maxLength={40} required={Boolean(draft.registerCourt.trim())} onChange={event => edit({ registerNumber: event.target.value })} /><FieldError id="ad-register-number-error">{fields.error("ad-register-number") ?? ""}</FieldError></div>
          </div>
          <div className="ow-field"><label htmlFor="ad-vat">USt-IdNr.</label><input id="ad-vat" {...fields.aria("ad-vat")} className="ow-input" placeholder="z. B. DE123456789" autoCapitalize="characters" value={draft.vatId} maxLength={20} onChange={event => edit({ vatId: event.target.value })} /><FieldError id="ad-vat-error">{fields.error("ad-vat") ?? ""}</FieldError></div>
          <p className="ow-hint">Leere Felder erscheinen nicht in der E-Mail.</p>
        </fieldset>
        <SaveBar asSubmit state={shown} onDiscard={() => { setDraft(saved); setState("clean"); setError(""); }} canSave={changed} saveLabel="Anschrift speichern" detail={shown === "error" ? `${error} Deine Eingaben sind noch da.` : undefined} />
      </form>
    </section>
  );
}
