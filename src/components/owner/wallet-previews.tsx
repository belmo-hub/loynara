"use client";

import Image from "next/image";
import { BrowserCardPreview, type CardPreviewProps } from "./card-preview";
import { readableInk } from "./color";

export type Surface = "browser" | "apple" | "google";
export type PreviewData = CardPreviewProps & { programName: string; logoData: string | null };

const isPng = (logo: string | null) => Boolean(logo?.startsWith("data:image/png;base64,"));

// Decorative placeholder only: not a scannable code.
function CodeMock() {
  const cells = Array.from({ length: 49 }, (_, index) => ((index * 7 + Math.floor(index / 7) * 3) % 5) < 2);
  return <svg className="ow-pass-code" viewBox="0 0 7 7" aria-hidden="true" focusable="false">{cells.map((on, index) => on ? <rect key={index} x={index % 7} y={Math.floor(index / 7)} width="1" height="1" /> : null)}</svg>;
}

function ApplePass({ data }: { data: PreviewData }) {
  const unit = data.programType === "points" ? "PUNKTE" : "STEMPEL";
  return (
    <div className="ow-pass ow-pass--apple" style={{ backgroundColor: data.brandColor, color: "#ffffff" }} role="img" aria-label={`Apple-Wallet-Vorschau: ${data.businessName}, ${data.balance} ${unit}`}>
      <div className="ow-pass-row"><strong className="ow-pass-title">{data.businessName || "Dein Geschäft"}</strong><span className="ow-pass-field"><small>{unit}</small><b className="ow-num">{data.balance}</b></span></div>
      <div className="ow-pass-row ow-pass-row--sec"><span className="ow-pass-field"><small style={{ color: "rgb(230, 240, 237)" }}>STANDORT</small><b>{data.locationName}</b></span><span className="ow-pass-field"><small style={{ color: "rgb(230, 240, 237)" }}>KARTE</small><b>A1B2C3D4</b></span></div>
      <div className="ow-pass-codewrap"><CodeMock /></div>
    </div>
  );
}

function GooglePass({ data }: { data: PreviewData }) {
  const ink = readableInk(data.brandColor);
  const unit = data.programType === "points" ? "Punkte" : "Stempel";
  const logo = isPng(data.logoData) ? data.logoData : null;
  return (
    <div className="ow-pass ow-pass--google" style={{ backgroundColor: data.brandColor, color: ink }} role="img" aria-label={`Google-Wallet-Vorschau: ${data.businessName}, ${data.balance} ${unit}`}>
      <div className="ow-pass-row"><span className="ow-pass-issuer">{logo ? <Image unoptimized src={logo} alt="" width={32} height={32} /> : <span className="ow-pass-initial" aria-hidden="true">{(data.businessName || "?").slice(0, 1).toUpperCase()}</span>}<strong>{data.businessName || "Dein Geschäft"}</strong></span></div>
      <div className="ow-pass-program">{data.programName}</div>
      <div className="ow-pass-big"><small>{unit}</small><b className="ow-num">{data.balance}</b></div>
      <div className="ow-pass-codewrap ow-pass-codewrap--light"><CodeMock /></div>
    </div>
  );
}

export function SurfacePreview({ surface, data }: { surface: Surface; data: PreviewData }) {
  if (surface === "browser") return <BrowserCardPreview {...data} />;
  return surface === "apple" ? <ApplePass data={data} /> : <GooglePass data={data} />;
}
