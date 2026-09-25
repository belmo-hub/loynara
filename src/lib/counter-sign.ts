type CounterSignInput = {
  businessName: string;
  locationName: string;
  joinUrl: string;
  qrSvg: string;
  programType: "stamp" | "points" | undefined;
  rewardTitle: string | undefined;
  rewardCost: number | undefined;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character] ?? character);

export function counterSignHtml(input: CounterSignInput): string {
  if (!/^<svg\b[^>]*>[\s\S]*<\/svg>\s*$/.test(input.qrSvg)) throw new Error("QR-Code ist nicht verfügbar.");
  if (!input.businessName.trim() || !input.locationName.trim() || !["stamp", "points"].includes(input.programType ?? "")
    || !input.rewardTitle?.trim() || !Number.isInteger(input.rewardCost) || (input.rewardCost ?? 0) < 1) {
    throw new Error("Geschäft oder Prämienregel ist unvollständig.");
  }
  const origin = new URL(input.joinUrl);
  const local = origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (!(origin.protocol === "https:" || local) || !/^\/join\/[a-z0-9-]{1,120}$/.test(origin.pathname)
    || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error("Anmeldelink ist nicht gültig.");
  }
  const dense = Math.max(input.businessName.length, input.locationName.length, input.rewardTitle.length) > 55
    || input.businessName.length + input.locationName.length + input.rewardTitle.length > 120;
  const reward = `<p class="reward">${escapeHtml(String(input.rewardCost))} ${input.programType === "points" ? "Punkte" : "Stempel"} → ${escapeHtml(input.rewardTitle)}</p>`;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(input.businessName)} · Anmeldeschild</title>
<style>
  :root{color-scheme:light;--forest:#193b2d;--green:#2f6b58;--paper:#f4f1e9}
  *{box-sizing:border-box}body{margin:0;background:#e6ebe4;color:var(--forest);font-family:Arial,Helvetica,sans-serif}
  .sheet{width:148mm;min-height:210mm;margin:18px auto;padding:12mm 13mm 9mm;background:var(--paper);box-shadow:0 14px 40px #193b2d22;display:flex;flex-direction:column;align-items:center;text-align:center}
  .eyebrow{margin:7mm 0 3mm;color:var(--green);font-size:10px;font-weight:800;letter-spacing:.18em}h1{margin:0;font-size:31px;line-height:1.06;letter-spacing:-.06em;overflow-wrap:anywhere}
  .location{margin:2mm 0 0;font-size:14px;font-weight:700;overflow-wrap:anywhere}.sub{margin:3mm 0 7mm;font-size:14px}
  .qr{width:76mm;height:76mm;padding:3mm;border:2px solid var(--green);border-radius:8mm;background:#fff}.qr svg{display:block;width:100%;height:100%}
  .instruction{margin:7mm 0 2mm;font-size:18px;line-height:1.2;font-weight:800;letter-spacing:-.04em}.reward{margin:2mm 0 0;font-size:14px;font-weight:700;overflow-wrap:anywhere}
  .join-url{width:100%;margin:7mm 0 0;padding:3mm;border-top:1px solid #c9d8ca;border-bottom:1px solid #c9d8ca;overflow-wrap:anywhere;font-size:10px;font-weight:700}
  .note{margin:auto 0 0;padding-top:5mm;color:#415d49;font-size:9px;line-height:1.4;text-align:left}.attribution{align-self:flex-end;margin:4mm 0 0;color:#415d49;font-size:10px;font-weight:700}
  .sheet--dense{height:210mm;min-height:0;padding:9mm 10mm 7mm}
  .sheet--dense .eyebrow{margin:1mm 0;font-size:9px}.sheet--dense h1{font-size:20px;line-height:1.08;letter-spacing:-.03em}
  .sheet--dense .location{margin:1mm 0 0;font-size:12px;line-height:1.14}.sheet--dense .sub{margin:2mm 0 4mm;font-size:12px}
  .sheet--dense .qr{width:72mm;height:72mm;padding:2mm}.sheet--dense .instruction{margin:4mm 0 1mm;font-size:16px}
  .sheet--dense .reward{margin:1mm 0 0;font-size:12px;line-height:1.2}.sheet--dense .join-url{margin:4mm 0 0;padding:1.5mm;font-size:9px;line-height:1.15}
  .sheet--dense .note{padding-top:2mm;font-size:8px;line-height:1.2}.sheet--dense .attribution{margin:2mm 0 0;font-size:9px}
  @page{size:A5 portrait;margin:0}@media print{body{background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet{margin:0;box-shadow:none}}
</style></head><body><main class="sheet${dense ? " sheet--dense" : ""}">
<p class="eyebrow">${input.programType === "points" ? "PUNKTEKARTE" : "STEMPELKARTE"}</p><h1>${escapeHtml(input.businessName)}</h1><p class="location">${escapeHtml(input.locationName)}</p><p class="sub">Deine digitale Treuekarte im Browser</p>
<div class="qr" role="img" aria-label="QR-Code zur Anmeldung">${input.qrSvg}</div><p class="instruction">QR scannen. Karte erstellen.</p>${reward}
<p class="join-url">${escapeHtml(input.joinUrl)}</p><p class="note">${local ? "LOKALE TESTVORSCHAU · Dieser Link funktioniert nur auf dem Rechner, auf dem LoopLocal unter localhost läuft. Für einen Test mit zwei Geräten ist eine freigegebene HTTPS-Vorschau nötig." : "Speichere nach der Anmeldung deinen privaten Kartenlink. Ohne ihn ist die Karte derzeit nicht wiederherstellbar."}</p><p class="attribution">Mit LoopLocal</p>
</main></body></html>`;
}
