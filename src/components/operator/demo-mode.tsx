"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ClientApiError, imageToDataUrl, newRequestId, postJson } from "@/components/client-api";
import { Choices } from "@/components/owner/question-form";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { useFormCheck } from "@/components/ui/form-check";
import { SHOP_TEMPLATES } from "@/lib/shop-templates";

export type DemoRunning = { name: string; hoursLeft: number };

const OFFLINE = "Keine Verbindung. Bitte noch einmal tippen.";

/** Demo-Modus on /operator, demo environment only (design v3 and section 6). One column, built for the phone. */
export function DemoMode({ running: initial }: { running: DemoRunning | null }) {
  const router = useRouter();
  const [running, setRunning] = useState(initial);
  const [templateId, setTemplateId] = useState(SHOP_TEMPLATES[0].id);
  const template = SHOP_TEMPLATES.find(t => t.id === templateId)!;
  const [name, setName] = useState("");
  const [colour, setColour] = useState(template.colours[0]);
  const [reward, setReward] = useState(template.rewardTitle);
  const [cost, setCost] = useState(String(template.cost));
  const [logoData, setLogoData] = useState<string | undefined>();
  const [logoError, setLogoError] = useState("");
  const fields = useFormCheck({ "op-demo-name": "Bitte gib den Namen des Geschäfts ein." });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Kept until the server answered: a retry after a lost answer sends the same key and gets the same demo back.
  const [key, setKey] = useState<string | null>(null);
  const unit = template.programType === "points" ? "Punkte" : "Stempel";

  const pickTemplate = (id: string) => {
    const next = SHOP_TEMPLATES.find(t => t.id === id)!;
    setTemplateId(id); setColour(next.colours[0]); setReward(next.rewardTitle); setCost(String(next.cost)); setKey(null);
  };
  const pickLogo = (file: File | undefined) => {
    setKey(null);
    if (!file) { setLogoData(undefined); setLogoError(""); return; }
    imageToDataUrl(file).then(data => { setLogoData(data); setLogoError(""); }, (cause: Error) => { setLogoData(undefined); setLogoError(cause.message); });
  };
  const edit = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setKey(null); };

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fields.check(event.currentTarget)) return;
    setError(""); setBusy(true);
    const sent = key ?? newRequestId();
    setKey(sent);
    try {
      const result = await postJson<DemoRunning>("/api/operator/demo", { key: sent, templateId, businessName: name.trim(), logoData, brandColor: colour, rewardTitle: reward.trim(), rewardCost: Number(cost) });
      setRunning(result); setKey(null); router.refresh();
    } catch (cause) {
      setError(cause instanceof ClientApiError && cause.status !== 0 ? cause.message : OFFLINE);
    } finally { setBusy(false); }
  }

  return <Card as="section" aria-labelledby="op-demo">
    <CardHeader id="op-demo" title="Demo-Modus" description="Ein Geschäft für 24 Stunden, mit Karte im Wallet. Danach wird alles gelöscht." />
    {running ? <div className="ow-stack ow-stack--tight">
      <p role="status">Demo läuft: {running.name}, noch {running.hoursLeft} Std.</p>
      <a className={buttonClassName({ variant: "secondary", block: true })} href="/cashier">Kasse öffnen</a>
      <a className={buttonClassName({ variant: "secondary", block: true })} href="/merchant">App des Geschäfts öffnen</a>
    </div> : null}
    <form onSubmit={start} onInput={fields.onInput} noValidate className="ow-stack">
      <Choices name="op-demo-type" label="Art des Geschäfts" value={templateId} onChange={pickTemplate}
        options={SHOP_TEMPLATES.map(t => ({ value: t.id, label: t.label }))} />
      <TextField id="op-demo-name" label="Name des Geschäfts" value={name} required minLength={2} maxLength={180} autoComplete="off" error={fields.error("op-demo-name")} onChange={event => edit(setName)(event.target.value)} />
      <TextField id="op-demo-logo" label="Logo (optional)" type="file" accept="image/png,image/jpeg,image/webp" error={logoError} hint="Foto vom Schild oder ein Bild aus Instagram." onChange={event => pickLogo(event.target.files?.[0])} />
      <div>
        <p id="op-demo-colour">Farbe</p>
        <div className="ow-swatches" role="group" aria-labelledby="op-demo-colour">{template.colours.map(hex => <button key={hex} type="button" className="ow-swatch" style={{ backgroundColor: hex }} aria-label={`Farbe ${hex}`} aria-pressed={colour === hex} onClick={() => edit(setColour)(hex)} />)}</div>
      </div>
      <TextField id="op-demo-reward" label="Prämie" value={reward} maxLength={180} autoComplete="off" onChange={event => edit(setReward)(event.target.value)} />
      <TextField id="op-demo-cost" label={`${unit} bis zur Prämie`} value={cost} inputMode="numeric" autoComplete="off" onChange={event => edit(setCost)(event.target.value)} />
      {error ? <p role="alert">{error}</p> : null}
      <Button type="submit" block loading={busy} disabled={busy}>{running ? "Neu starten" : "Demo starten"}</Button>
    </form>
  </Card>;
}
