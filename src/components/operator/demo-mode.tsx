"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useReducer, useRef, useState, type FormEvent } from "react";
import { ClientApiError, imageToDataUrl, newRequestId, postJson } from "@/components/client-api";
import { FieldError } from "@/components/owner/question-form";
import { swatchName } from "@/components/owner/swatches";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { useFormCheck } from "@/components/ui/form-check";
import { SHOP_TEMPLATES } from "@/lib/shop-templates";
import { costProblem, demoForm, initialDemoForm } from "./demo-form";

export type DemoRunning = { name: string; hoursLeft: number };

const OFFLINE = "Keine Verbindung. Bitte noch einmal tippen.";
const NBSP = " ";
const runningText = (running: DemoRunning) => `Demo läuft: ${running.name}, noch ${running.hoursLeft}${NBSP}Std.`;

/** Demo-Modus on /operator, demo environment only (design v3 and section 6). One column, built for the phone. */
export function DemoMode({ running: initial }: { running: DemoRunning | null }) {
  const router = useRouter();
  const [running, setRunning] = useState(initial);
  const [formOpen, setFormOpen] = useState(!initial);
  const [f, dispatch] = useReducer(demoForm, undefined, initialDemoForm);
  const [costError, setCostError] = useState("");
  const [error, setError] = useState("");
  const [announced, setAnnounced] = useState("");
  const statusLine = useRef<HTMLParagraphElement>(null);
  const logoPick = useRef(0);
  const fields = useFormCheck({ "op-demo-name": "Bitte gib den Namen des Geschäfts ein.", "op-demo-reward": "Bitte gib die Prämie ein." });
  const template = SHOP_TEMPLATES.find(t => t.id === f.templateId)!;
  const unit = template.programType === "points" ? "Punkte" : "Stempel";
  const busy = f.sending || f.logoBusy;

  const pickLogo = (file: File | undefined) => {
    const pick = ++logoPick.current;
    if (!file) { dispatch({ type: "logo" }); return; }
    dispatch({ type: "logo", logoData: f.logoData, logoBusy: true });
    imageToDataUrl(file).then(logoData => pick === logoPick.current && dispatch({ type: "logo", logoData }), (cause: Error) => pick === logoPick.current && dispatch({ type: "logo", logoError: cause.message }));
  };

  // „Neue Demo“: the form opens where the next choice is, the pressed type chip.
  const openForm = () => {
    setFormOpen(true);
    requestAnimationFrame(() => (document.querySelector<HTMLElement>('#op-demo-types [aria-pressed="true"]') ?? document.getElementById("op-demo-name"))?.focus());
  };

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second tap while a start is on its way, or while the logo is read, does nothing: no second shop.
    if (busy) return;
    setError("");
    const checked = fields.check(event.currentTarget);
    const cost = costProblem(f.cost);
    setCostError(cost);
    if (checked && cost) document.getElementById("op-demo-cost")?.focus();
    if (!checked || cost) return;
    const key = f.key ?? newRequestId();
    dispatch({ type: "send", key });
    try {
      const result = await postJson<DemoRunning>("/api/operator/demo", { key, templateId: f.templateId, businessName: f.name.trim(), logoData: f.logoData, brandColor: f.colour, rewardTitle: f.reward.trim(), rewardCost: Number(f.cost) });
      dispatch({ type: "started" }); logoPick.current++;
      setRunning(result); setFormOpen(false); setAnnounced(runningText(result));
      requestAnimationFrame(() => { statusLine.current?.focus(); statusLine.current?.scrollIntoView({ block: "start" }); });
      router.refresh();
    } catch (cause) {
      dispatch({ type: "failed" });
      setError(cause instanceof ClientApiError && cause.status !== 0 ? cause.message : OFFLINE);
    }
  }

  return <Card as="section" aria-labelledby="op-demo">
    <CardHeader id="op-demo" title="Demo-Modus" description="Ein Geschäft für 24 Stunden, mit Karte im Wallet. Danach wird alles gelöscht." />
    {/* Always rendered: iOS announces a live region reliably only when it exists before its text changes. */}
    <p className="ow-sr" role="status">{announced}</p>
    <div className="ow-stack">
      {running ? <div className="ow-group ow-stack ow-stack--tight">
        <p ref={statusLine} tabIndex={-1} className="ow-label">{runningText(running)}</p>
        <a className={buttonClassName({ variant: "primary", block: true })} href="/cashier">Kasse öffnen</a>
        <a className={buttonClassName({ variant: "secondary", block: true })} href="/merchant">App des Geschäfts öffnen</a>
        {!formOpen ? <Button variant="quiet" block onClick={openForm}>Neue Demo</Button> : null}
      </div> : null}
      {formOpen ? <form onSubmit={start} onInput={fields.onInput} noValidate className="ow-group ow-stack" aria-labelledby={running ? "op-demo-next" : undefined}>
        {running ? <h3 id="op-demo-next" className="ow-label">Neue Demo</h3> : null}
        <div className="ow-field">
          <span className="ow-label" id="op-demo-type">Art des Geschäfts</span>
          <div id="op-demo-types" className="ow-seg ow-seg--chips" role="group" aria-labelledby="op-demo-type">
            {SHOP_TEMPLATES.map(t => <button key={t.id} type="button" aria-pressed={t.id === f.templateId} onClick={() => dispatch({ type: "template", id: t.id })}>{t.label}</button>)}
          </div>
        </div>
        <div className="ow-field">
          <label htmlFor="op-demo-name">Name des Geschäfts</label>
          <input id="op-demo-name" className="ow-input" value={f.name} required minLength={2} maxLength={180} autoComplete="off" enterKeyHint="go" {...fields.aria("op-demo-name")} onChange={event => dispatch({ type: "edit", patch: { name: event.target.value } })} />
          <FieldError id="op-demo-name-error">{fields.error("op-demo-name") ?? ""}</FieldError>
        </div>
        <div className="ow-field">
          <span className="ow-label" id="op-demo-colour">Farbe</span>
          <div className="ow-swatches" role="group" aria-labelledby="op-demo-colour">{template.colours.map(hex => <button key={hex} type="button" className="ow-swatch" style={{ backgroundColor: hex }} aria-label={swatchName(hex) ?? hex} aria-pressed={f.colour === hex} onClick={() => dispatch({ type: "edit", patch: { colour: hex } })} />)}</div>
        </div>
        <div className="ow-field">
          <span className="ow-label">Logo (optional)</span>
          <div className="ow-logo-row">
            {f.logoData && <Image unoptimized className="ow-logo-thumb" src={f.logoData} width={112} height={35} alt="Ausgewähltes Logo" style={{ backgroundColor: f.colour }} />}
            <label htmlFor="op-demo-logo" className="ow-btn ow-btn--secondary ow-filebtn">{f.logoData ? "Anderes Logo wählen" : "Logo wählen"}<input id="op-demo-logo" className="ow-sr" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => pickLogo(event.target.files?.[0])} /></label>
            {f.logoData && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => pickLogo(undefined)}>Logo entfernen</button>}
          </div>
          <span className="ow-hint">Foto vom Schild oder ein Bild aus Instagram.</span>
          {f.logoError && <span className="ow-error" role="alert">{f.logoError}</span>}
        </div>
        <div className="ow-field">
          <label htmlFor="op-demo-reward">Prämie</label>
          <input id="op-demo-reward" className="ow-input" value={f.reward} required minLength={2} maxLength={180} autoComplete="off" {...fields.aria("op-demo-reward")} onChange={event => dispatch({ type: "edit", patch: { reward: event.target.value } })} />
          <FieldError id="op-demo-reward-error">{fields.error("op-demo-reward") ?? ""}</FieldError>
        </div>
        <div className="ow-field">
          <label htmlFor="op-demo-cost">{unit} bis zur Prämie</label>
          <input id="op-demo-cost" className="ow-input" value={f.cost} inputMode="numeric" autoComplete="off" aria-invalid={costError ? true : undefined} aria-describedby={costError ? "op-demo-cost-error" : undefined} onChange={event => { setCostError(""); dispatch({ type: "edit", patch: { cost: event.target.value } }); }} />
          <FieldError id="op-demo-cost-error">{costError}</FieldError>
        </div>
        {error ? <p className="ow-error" role="alert">{error}</p> : null}
        <Button type="submit" variant={running ? "secondary" : "primary"} block loading={busy}>{running ? "Neu starten" : "Demo starten"}</Button>
      </form> : null}
    </div>
  </Card>;
}
