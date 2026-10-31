"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { postJson } from "@/components/client-api";
import { setFlash } from "@/components/owner/flash";
import type { LocationList } from "@/components/owner/locations-data";
import { useDirtyGuard, useOwner } from "@/components/owner/owner-context";
import { locationCreateMessage, locationSwitchMessage } from "@/components/owner/owner-errors";
import { PageTitle } from "@/components/owner/owner-rows";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/owner/owner-ui";
import { EXTRA_RULES_LABEL, RULE_PLACEHOLDER, SETUP_EXTRA_RULES_HINT } from "@/components/owner/program-helpers";
import { useLoad } from "@/components/owner/use-load";
import { FieldError } from "@/components/owner/question-form";
import { useFormCheck } from "@/components/ui/form-check";

type Draft = { name: string; city: string; timezone: string; programName: string; programType: "stamp" | "points"; pointsPerCurrencyUnit: number; rulesText: string; rewardTitle: string; rewardCost: number };
const emptyDraft: Draft = { name: "", city: "", timezone: "Europe/Berlin", programName: "", programType: "stamp", pointsPerCurrencyUnit: 1, rulesText: "", rewardTitle: "", rewardCost: 5 };
const BACK = { href: "/merchant/locations", label: "Standorte" };

/** „Standort hinzufügen“ (ENG-122c): the 3c form on a page of its own; the new location becomes the active one. */
export default function NewLocationPage() {
  const owner = useOwner();
  const me = owner.me;
  const router = useRouter();
  const [list, reload] = useLoad<LocationList>(me?.role === "owner" ? "/api/merchant/locations" : null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stamps = draft.programType === "stamp";
  const fields = useFormCheck({
    "lc-name": "Bitte gib einen Standortnamen mit mindestens 2 Zeichen ein.",
    "lc-city": "Bitte gib die Stadt ein.",
    "lc-prog": "Bitte gib einen Programmnamen mit mindestens 2 Zeichen ein.",
    "lc-rules": `Bitte schreibe mindestens 10 Zeichen, z. B. ${stamps ? "„Ein Stempel pro Kaffee.“" : "„1 Punkt pro Euro.“"}`,
    "lc-reward": "Bitte gib die erste Prämie ein, z. B. „Kaffee aufs Haus“.",
    "lc-cost": `Bitte gib ein, wie viele ${stamps ? "Stempel" : "Punkte"} die Prämie kostet.`,
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(emptyDraft);
  useDirtyGuard("location-draft", dirty);
  if (!me) return null;
  const currency = list.state === "ok" ? list.data.currency : null;
  const head = <PageTitle back={BACK} title="Standort hinzufügen" lead={currency && `Der neue Standort startet ohne Karten. Währung und Land bleiben: ${currency}\u00a0· ${currency === "EUR" ? "Deutschland" : "Marokko"}.`} />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können Standorte verwalten.</Notice></div>;
  if (list.state === "error") return <div className="ow-page">{head}<ErrorNotice message={list.message} onRetry={reload} /></div>;
  if (!currency) return <div className="ow-page">{head}<LoadingBlock rows={3} /></div>;
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !fields.check(event.currentTarget)) return;
    setBusy(true); setError("");
    try {
      let created: { locationId: string };
      try { created = await postJson<{ locationId: string }>("/api/merchant/locations", { ...draft, country: currency === "EUR" ? "DE" : "MA", earningMode: draft.programType === "points" ? "purchase" : "manual" }); }
      catch (cause) { setError(locationCreateMessage(cause)); return; }
      try { await postJson("/api/merchant/locations/select", { locationId: created.locationId }); }
      catch (cause) {
        // The location exists now: empty the form (sending it again would hit LOCATION_EXISTS); Standorte lists it.
        setDraft(emptyDraft); owner.setDirty("location-draft", false); void owner.refresh();
        setError(`Der neue Standort wurde angelegt. ${locationSwitchMessage(cause)}`);
        return;
      }
      setFlash("Standort mit eigenem Programm und eigener Prämie angelegt und ausgewählt. Bestehende Karten und Guthaben blieben am bisherigen Standort.");
      owner.setDirty("location-draft", false);
      // The shell remounts for the new active location first, so Standorte mounts once and shows the message.
      await owner.refresh();
      router.push("/merchant/locations");
    } finally { setBusy(false); }
  }

  return (
    <div className="ow-page ow-qpage">
      {head}
      {error && <ErrorNotice message={error} />}
      <form onSubmit={create} onInput={fields.onInput} className="ow-q" noValidate>
        <div className="ow-qpanel ow-stack">
          <Field error={fields.error} id="lc-name" label="Standortname"><input id="lc-name" {...fields.aria("lc-name")} className="ow-input" value={draft.name} onChange={event => set({ name: event.target.value })} minLength={2} maxLength={180} required /></Field>
          <Field error={fields.error} id="lc-city" label="Stadt"><input id="lc-city" {...fields.aria("lc-city")} className="ow-input" value={draft.city} onChange={event => set({ city: event.target.value })} minLength={2} maxLength={120} required /></Field>
          <Field error={fields.error} id="lc-tz" label="Zeitzone"><input id="lc-tz" {...fields.aria("lc-tz")} className="ow-input" value={draft.timezone} onChange={event => set({ timezone: event.target.value })} minLength={3} maxLength={80} required /></Field>
          <Field error={fields.error} id="lc-prog" label="Programmname"><input id="lc-prog" {...fields.aria("lc-prog")} className="ow-input" value={draft.programName} onChange={event => set({ programName: event.target.value })} minLength={2} maxLength={180} required /></Field>
          {/* Into points by purchase amount the text starts over as extra rules, as in setup (W51). */}
          <Field error={fields.error} id="lc-type" label="Programmtyp"><select id="lc-type" className="ow-select" value={draft.programType} onChange={event => set({ programType: event.target.value as Draft["programType"], ...(event.target.value === "points" ? { rulesText: "" } : {}) })}><option value="stamp">Stempel, manuelle Vergabe</option><option value="points">Punkte je Kaufbetrag</option></select></Field>
          {draft.programType === "points" && <Field error={fields.error} id="lc-rate" label={`Punkte pro 1 ${currency}`}><input id="lc-rate" {...fields.aria("lc-rate")} className="ow-input" type="number" value={draft.pointsPerCurrencyUnit} onChange={event => set({ pointsPerCurrencyUnit: Number(event.target.value) })} min={1} max={1000} step={1} required /></Field>}
          {/* Points here earn by the purchase amount: the card states that rule, so the text holds optional extra rules. */}
          <Field error={fields.error} id="lc-rules" label={draft.programType === "points" ? EXTRA_RULES_LABEL : "Teilnahmebedingungen"}>
            <textarea id="lc-rules" {...fields.aria("lc-rules")} className="ow-textarea" value={draft.rulesText} onChange={event => set({ rulesText: event.target.value })} maxLength={3000} rows={4}
              {...(draft.programType === "points" ? { placeholder: RULE_PLACEHOLDER.purchase, "aria-describedby": "lc-rules-hint" } : { minLength: 10, required: true })} />
            {draft.programType === "points" && <span id="lc-rules-hint" className="ow-hint">{SETUP_EXTRA_RULES_HINT}</span>}
          </Field>
          <Field error={fields.error} id="lc-reward" label="Erste Prämie"><input id="lc-reward" {...fields.aria("lc-reward")} className="ow-input" value={draft.rewardTitle} onChange={event => set({ rewardTitle: event.target.value })} minLength={2} maxLength={180} required /></Field>
          <Field error={fields.error} id="lc-cost" label={`Kosten in ${draft.programType === "stamp" ? "Stempeln" : "Punkten"}`}><input id="lc-cost" {...fields.aria("lc-cost")} className="ow-input ow-field--narrow" type="number" value={draft.rewardCost} onChange={event => set({ rewardCost: Number(event.target.value) })} min={1} max={100000} step={1} required /></Field>
        </div>
        <div className="ow-qsave"><button type="submit" className="ow-btn ow-btn--primary" disabled={busy} aria-busy={busy}>{busy ? "Wird angelegt …" : "Standort und Programm anlegen"}</button></div>
      </form>
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error: (id: string) => string | undefined; children: React.ReactNode }) {
  return <div className="ow-field"><label htmlFor={id}>{label}</label>{children}<FieldError id={`${id}-error`}>{error(id) ?? ""}</FieldError></div>;
}
