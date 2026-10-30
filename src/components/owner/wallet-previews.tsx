"use client";

import Image from "next/image";
import { useState, type SyntheticEvent } from "react";
import { withUnit } from "@/lib/units";
import { BrowserCardPreview, CodeMock, type CardPreviewProps } from "./card-preview";
import { readableInk } from "./color";

export type Surface = "browser" | "apple" | "google";
export type LogoWallet = { showName: boolean; faint: boolean; upscaled: boolean };
/** logoWallet is known only for the saved logo; without it the preview judges the logo by its shape. */
export type PreviewData = CardPreviewProps & { programName: string; logoData: string | null; logoWallet?: LogoWallet | null };

// Width over height once the logo image has loaded; 0 before. The server trims the saved logo, so this is its real shape.
function useLogoRatio() {
  const [ratio, setRatio] = useState(0);
  return [ratio, (event: SyntheticEvent<HTMLImageElement>) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)] as const;
}
const SAMPLE_LOCATOR = "K-7QX2MA";


/** Same derivation as lib/wallet/content: "7 / 10" for stamps, target reward, and a status line. */
function progress(data: PreviewData) {
  const unit = data.programType === "points" ? "Punkte" : "Stempel";
  const cost = Math.max(1, data.rewardCost);
  const ready = data.balance >= cost;
  return { unit, ready, balance: data.programType === "stamp" ? `${data.balance} / ${cost}` : String(data.balance), status: ready ? "An der Kasse einlösen" : `Noch ${withUnit(cost - data.balance, data.programType)}` };
}

/** Mirrors lib/wallet/apple: automatic light/dark text, the logo uncropped in its 160 x 50 pt slot, progress in the header. */
function ApplePass({ data }: { data: PreviewData }) {
  const ink = readableInk(data.brandColor);
  const label = ink === "#ffffff" ? "rgba(255, 255, 255, .78)" : "rgba(17, 17, 17, .72)";
  const p = progress(data);
  // A logo too faint on the brand colour stays off the pass, which shows the name instead.
  const logo = data.logoWallet?.faint ? null : data.logoData;
  const [ratio, onLoad] = useLogoRatio();
  const showName = !logo || (data.logoWallet ? data.logoWallet.showName : ratio < 2.2);
  const name = data.businessName || "Dein Geschäft";
  return (
    <div className="ow-pass ow-pass--apple" style={{ backgroundColor: data.brandColor, color: ink }} role="img" aria-label={`Apple-Wallet-Vorschau: ${name}, ${p.balance} ${p.unit}, ${p.status}`}>
      <div className="ow-pass-row">
        <span className="ow-pass-issuer">{logo && <Image unoptimized src={logo} alt="" width={170} height={53} className="ow-pass-logo" onLoad={onLoad} />}{showName && <strong className="ow-pass-title">{name}</strong>}</span>
        <span className="ow-pass-field ow-pass-field--end"><small style={{ color: label }}>{p.unit.toUpperCase()}</small><b className="ow-num">{p.balance}</b></span>
      </div>
      <div className="ow-pass-field ow-pass-primary"><small style={{ color: label }}>{p.ready ? "PRÄMIE BEREIT" : "NÄCHSTE PRÄMIE"}</small><b>{data.rewardTitle}</b></div>
      <div className="ow-pass-row ow-pass-row--sec">
        <span className="ow-pass-field"><small style={{ color: label }}>STATUS</small><b>{p.status}</b></span>
        <span className="ow-pass-field ow-pass-field--end"><small style={{ color: label }}>KARTE</small><b>{SAMPLE_LOCATOR}</b></span>
      </div>
      <span className="ow-pass-field"><small style={{ color: label }}>STANDORT</small><b>{data.locationName}</b></span>
      <CodeMock caption={SAMPLE_LOCATOR} />
    </div>
  );
}

/** Mirrors lib/wallet/google: Google lays the card out itself; colour, logo, names and the points line come from us. A square or round logo sits in Google's circle, a wide one keeps its rectangle. */
function GooglePass({ data }: { data: PreviewData }) {
  const ink = readableInk(data.brandColor);
  const p = progress(data);
  // Same contrast rule as Apple: a faint logo gives way to the initial and the name.
  const logo = data.logoWallet?.faint ? null : data.logoData;
  const [ratio, onLoad] = useLogoRatio();
  const square = ratio >= 0.8 && ratio <= 1.25;
  // Google's loyalty template: with wideProgramLogo the card title is the wide logo and the programme name, no issuer name.
  const wide = Boolean(logo) && !square;
  const name = data.businessName || "Dein Geschäft";
  return (
    <div className="ow-pass ow-pass--google" style={{ backgroundColor: data.brandColor, color: ink }} role="img" aria-label={`Google-Wallet-Vorschau: ${name}, ${p.balance} ${p.unit}, ${p.status}`}>
      <div className="ow-pass-row"><span className="ow-pass-issuer">{logo ? <Image unoptimized src={logo} alt="" width={160} height={32} className={square ? "ow-pass-mark" : "ow-pass-wide"} onLoad={onLoad} /> : <span className="ow-pass-initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}{!wide && <strong>{name}</strong>}</span></div>
      <div className="ow-pass-program">{data.programName}</div>
      <div className="ow-pass-row"><span className="ow-pass-big"><small>{p.unit}</small><b className="ow-num">{p.balance}</b></span><span className="ow-pass-field ow-pass-field--end"><small>Mitgliedskarte</small><b>{SAMPLE_LOCATOR}</b></span></div>
      <div className="ow-pass-module"><small>{p.ready ? "Prämie bereit" : "Nächste Prämie"}</small><span>{data.rewardTitle} · {p.status}</span></div>
      <CodeMock caption={SAMPLE_LOCATOR} />
    </div>
  );
}

export function SurfacePreview({ surface, data }: { surface: Surface; data: PreviewData }) {
  if (surface === "browser") return <BrowserCardPreview {...data} />;
  return surface === "apple" ? <ApplePass data={data} /> : <GooglePass data={data} />;
}
