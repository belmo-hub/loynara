"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiJson, ClientApiError, imageToDataUrl, postJson, type MeResponse, type PublicProgram } from "@/components/client-api";
import { BrandMark, Icon, MerchantSetupView, type SetupInput } from "@/components/loyalty-ui";
import { RewardManager } from "@/components/reward-manager";

type Mode = "loading" | "setup" | "existing" | "error";

export default function ProgramPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [program, setProgram] = useState<PublicProgram | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError(""); setMode("loading");
    try {
      const current = await apiJson<MeResponse>("/api/me");
      if (!current.programSlug) { setMode("setup"); return; }
      setMe(current);
      const detail = await apiJson<PublicProgram>(`/api/program/${encodeURIComponent(current.programSlug)}`);
      setProgram(detail); setMode("existing");
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 404 && !me) { setMode("setup"); return; }
      setError(cause instanceof Error ? cause.message : "Programm konnte nicht geladen werden."); setMode("error");
    }
  }, [router, me]);

  useEffect(() => {
    let active = true;
    void apiJson<MeResponse>("/api/me").then(async current => {
      if (!active) return;
      if (!current.programSlug) { setMode("setup"); return; }
      setMe(current);
      try {
        const detail = await apiJson<PublicProgram>(`/api/program/${encodeURIComponent(current.programSlug)}`);
        if (active) { setProgram(detail); setMode("existing"); }
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : "Programm konnte nicht geladen werden."); setMode("error"); }
      }
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 404) { setMode("setup"); return; }
      setError(cause instanceof Error ? cause.message : "Programm konnte nicht geladen werden."); setMode("error");
    });
    return () => { active = false; };
  }, [router]);

  async function submit(input: SetupInput) {
    setBusy(true); setError("");
    try {
      const logoData = input.logoFile ? await imageToDataUrl(input.logoFile) : undefined;
      await postJson<{ programSlug: string }>("/api/merchant/onboard", {
        businessName: input.businessName, city: input.city, country: input.country,
        timezone: input.timezone, locale: input.locale, currency: input.currency,
        programName: input.programName, programType: input.type === "stamps" ? "stamp" : "points",
        earningMode: input.type === "points" ? "purchase" : "manual", pointsPerCurrencyUnit: input.pointsPerCurrencyUnit,
        rulesText: input.rules, rewardTitle: input.rewardName, rewardCost: input.rewardCost,
        locationName: input.locationName, ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
        brandColor: input.brandColor, effectiveDate: input.effectiveDate, logoData,
        latitude: input.latitude, longitude: input.longitude,
      });
      router.replace("/merchant"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Programm konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  if (mode === "setup") return <MerchantSetupView saving={busy} error={error} onSubmit={submit} />;
  if (mode === "loading") return <ProgramState title="Programm wird geladen" message="Deine Konfiguration wird abgerufen." />;
  if (mode === "error" || !me || !program) return <ProgramState title="Programm nicht verfügbar" message={error || "Bitte versuche es erneut."} onRetry={load} />;

  if (!me.publicBaseUrl) return <ProgramState title="Anmeldelink nicht verfügbar" message="Die öffentliche Adresse ist noch nicht konfiguriert." />;
  const joinUrl = new URL(`/join/${encodeURIComponent(me.programSlug)}`, me.publicBaseUrl).toString();
  const qrSrc = `/api/qr?value=${encodeURIComponent(joinUrl)}`;
  return <div className="app-page"><header className="app-header"><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link>{me.role === "owner" && <Link href="/merchant/referrals">Empfehlungen</Link>}<Link href="/merchant/customers">Kundenkarten</Link>{me.role === "owner" && <Link href="/merchant/staff">Team</Link>}<Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Programm</span></div></header><main className="app-container program-view"><div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> DEIN PROGRAMM</span><h1>{program.programName}</h1><p>{program.businessName} · {program.locationName}</p></div><div className="program-view-grid"><div className="program-view-main"><section className="app-panel"><div className="panel-head"><span className="step-number"><Icon name="stamp" size={18} /></span><div><h2>Programmregeln</h2><p>So wird dein Programm öffentlich angezeigt.</p></div></div><dl className="program-details"><div><dt>Typ</dt><dd>{program.programType === "stamp" ? "Stempel" : "Punkte"}</dd></div><div><dt>Vergabe</dt><dd>{program.programType === "points" && program.earningMode === "purchase" ? `${program.pointsPerCurrencyUnit} Punkte pro 1 ${program.currency}; abrunden` : "Manuelle Menge an der Kasse"}</dd></div><div><dt>Prämien</dt><dd>{program.rewards?.length ?? 0} aktiv</dd></div></dl><div className="program-rules"><span className="tiny-label">TEILNAHMEBEDINGUNGEN</span><p>{program.rulesText}</p></div></section>{me.role === "owner" ? <><ProgramEditForm key={`${me.programSlug}-${program.programName}-${program.earningMode}-${program.pointsPerCurrencyUnit}`} slug={me.programSlug} program={program} transactionsExist={Boolean(me.stats && (me.stats.awards + me.stats.redemptions > 0))} onSaved={setProgram} /><RewardManager programSlug={me.programSlug} currency={program.currency} programType={program.programType} onChanged={async () => setProgram(await apiJson<PublicProgram>(`/api/program/${encodeURIComponent(me.programSlug)}`))} /></> : <><div className="program-info-banner"><Icon name="shield" size={19} /><p>Nur die Inhaberin oder der Inhaber kann Programmregeln ändern.</p></div><section className="app-panel"><h2>Aktive Prämien</h2><ul>{program.rewards?.map(reward => <li key={reward.id}>{reward.title} · {reward.cost} {program.programType === "stamp" ? "Stempel" : "Punkte"}</li>)}</ul></section></>}</div><aside className="program-view-side"><div className="app-panel program-join-panel"><span className="tiny-label">AM TRESEN TEILEN</span><h2>Anmeldung per QR</h2><div className="program-qr"><Image unoptimized src={qrSrc} alt="QR-Code zur öffentlichen Programmanmeldung" width={184} height={184} /></div><a href={joinUrl}>{joinUrl}</a><a className="button button--ink button--full" href={qrSrc} download="looplocal-anmeldung.svg"><Icon name="download" size={18} /> QR-Code laden</a></div></aside></div></main></div>;
}

function ProgramEditForm({ slug, program, transactionsExist, onSaved }: { slug: string; program: PublicProgram; transactionsExist: boolean; onSaved: (program: PublicProgram) => void }) {
  const [name, setName] = useState(program.programName);
  const [type, setType] = useState<"stamp" | "points">(program.programType);
  const [earningMode, setEarningMode] = useState<"manual" | "purchase">(program.earningMode ?? "manual");
  const [pointsPerCurrencyUnit, setPointsPerCurrencyUnit] = useState(program.pointsPerCurrencyUnit ?? 1);
  const [rulesText, setRulesText] = useState(program.rulesText);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function preview(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); setSuccess(""); setConfirming(true); }
  async function save() {
    setBusy(true); setError("");
    try {
      await postJson("/api/merchant/program/update", { programSlug: slug, name: name.trim(), programType: type, earningMode: type === "stamp" ? "manual" : earningMode, pointsPerCurrencyUnit, rulesText: rulesText.trim() });
      const updated = await apiJson<PublicProgram>(`/api/program/${encodeURIComponent(slug)}`);
      onSaved(updated);
      setSuccess("Die neue Regelversion wurde gespeichert."); setConfirming(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Änderung konnte nicht gespeichert werden."); setConfirming(false); }
    finally { setBusy(false); }
  }

  return <section className="app-panel program-edit-panel"><div className="panel-head"><span className="step-number"><Icon name="spark" size={18} /></span><div><h2>Programm ändern</h2><p>Vergaberegeln werden als neue Version gespeichert.</p></div></div><form className="program-edit-form" onSubmit={preview}><div className="field-grid"><label>Programmname<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={180} required /></label><label>Programmtyp<select value={type} onChange={e => { const next = e.target.value as "stamp" | "points"; setType(next); setEarningMode(next === "points" ? "purchase" : "manual"); }} disabled={transactionsExist}><option value="stamp">Stempel</option><option value="points">Punkte</option></select>{transactionsExist && <small>Nach ersten Buchungen bleibt der Typ fest.</small>}</label>{type === "points" && <><label>Vergabeart<select value={earningMode} onChange={e => setEarningMode(e.target.value as "manual" | "purchase")}><option value="purchase">Punkte je Kaufbetrag</option><option value="manual">Manuelle Punktemenge (bestehende Regel)</option></select></label>{earningMode === "purchase" && <label>Punkte pro 1 {program.currency}<input type="number" value={pointsPerCurrencyUnit} onChange={e => setPointsPerCurrencyUnit(Number(e.target.value))} min={1} max={1000} step={1} required /><small>Bruchteile von Punkten werden abgerundet.</small></label>}</>}<label className="field-wide">Teilnahmebedingungen<textarea value={rulesText} onChange={e => setRulesText(e.target.value)} minLength={10} maxLength={3000} rows={4} required /></label></div><div className="program-edit-note"><Icon name="shield" size={17} /> Die neue Vergaberegel gilt für künftige Buchungen. Vergangene Buchungen und Prämienversionen bleiben erhalten.</div>{error && <p className="auth-error" role="alert">{error}</p>}{success && <p className="inline-message inline-message--success" role="status">{success}</p>}<button type="submit" className="button button--ink">Änderungen prüfen <Icon name="arrow" size={17} /></button></form>{confirming && <div className="confirm-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setConfirming(false); }}><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="program-confirm-title"><span className="confirm-icon"><Icon name="shield" size={25} /></span><h2 id="program-confirm-title">Neue Vergaberegel speichern?</h2><p>{type === "points" && earningMode === "purchase" ? `${pointsPerCurrencyUnit} Punkte pro 1 ${program.currency}; Bruchteile werden abgerundet.` : "Die Menge wird an der Kasse eingegeben."} Bereits gebuchte Vorgänge bleiben unverändert.</p><div className="confirm-actions"><button type="button" className="button button--outline" onClick={() => setConfirming(false)}>Zurück</button><button type="button" className="button button--ink" disabled={busy} onClick={save}>{busy ? "Wird gespeichert …" : "Neue Regelversion speichern"}</button></div></div></div>}</section>;
}

function ProgramState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void | Promise<void> }) {
  return <main className="app-state-page"><div className="app-state-card"><BrandMark /><h1>{title}</h1><p>{message}</p>{onRetry && <button type="button" className="button button--ink" onClick={() => void onRetry()}>Erneut versuchen</button>}</div></main>;
}
