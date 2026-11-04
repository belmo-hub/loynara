"use client";

import { MapPin, Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { postJson } from "@/components/client-api";
import { CancellationNotice } from "@/components/owner/cancellation-notice";
import { clearFlash, peekFlash } from "@/components/owner/flash";
import { MORE_HREF } from "@/components/owner/nav";
import { useOwner } from "@/components/owner/owner-context";
import { MoreLabel, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { GuardedLink } from "@/components/owner/owner-shell";
import { ErrorNotice, Notice } from "@/components/owner/owner-ui";
import { SwitchRow } from "@/components/owner/question-form";
import { useLoad } from "@/components/owner/use-load";

/** Geschäft (ENG-122c, screen 13): the card's names, the active location, the weekly report, and „Programm beenden“ last. */
export default function MerchantSettingsPage() {
  const { me, locations, hiddenSurfaces } = useOwner();
  // O7: „Kündigung zurückgenommen“ is shown here, where the withdrawal returns, and read only once.
  const [flash] = useState(() => peekFlash());
  useEffect(() => { clearFlash(); }, []);
  if (!me) return null;
  const head = <PageTitle back={{ href: MORE_HREF, label: <MoreLabel /> }} title="Geschäft" lead="Name, Standort und Zugang für deine Kunden." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn">Die Einstellungen sind Inhaber:innen vorbehalten.</Notice></div>;
  const programName = locations.find(location => location.id === me.locationId)?.programName;
  return (
    <div className="ow-page">
      {head}
      {flash && <div role="status"><Notice tone="ok">{flash}</Notice></div>}
      <CancellationNotice me={me} />
      <div className="ow-prog">
        <Rows title="Dein Geschäft">
          {/* R14; where the logo upload is withheld the row promises no logo (W38's rule). */}
          <Row key="card" href="/merchant/program/card" icon={Palette} title={hiddenSurfaces.includes("cardLogo") ? "Name und Farbe" : "Name, Logo und Farbe"} sub={programName ? `${me.businessName} · ${programName}` : me.businessName} />
          <Row key="location" href="/merchant/locations" icon={MapPin} title="Aktiver Standort" value={me.locationName} off />
        </Rows>
        <Rows title="E-Mail"><WeeklyReport key="weekly" /></Rows>
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
