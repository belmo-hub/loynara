"use client";

import { BrandIcon } from "@/components/loyalty-ui";

export function readableInk(hex: string) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map(index => {
    const channel = parseInt(normalized.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) >= 4.5 ? "#ffffff" : "#000000";
}

export type CardPreviewProps = {
  businessName: string;
  locationName: string;
  brandColor: string;
  programType: "stamp" | "points";
  rewardTitle: string;
  rewardCost: number;
  balance: number;
};

/** Mirrors what a customer sees on the browser card: brand-coloured face plus balance and reward progress. */
export function BrowserCardPreview({ businessName, locationName, brandColor, programType, rewardTitle, rewardCost, balance }: CardPreviewProps) {
  const ink = readableInk(brandColor);
  const unit = programType === "points" ? "Punkte" : "Stempel";
  const cost = Math.max(1, rewardCost);
  const shown = Math.min(balance, cost);
  const remaining = Math.max(0, cost - balance);
  return (
    <div className="ow-cardprev">
      <div className="ow-cardprev-face" style={{ backgroundColor: brandColor, color: ink }}>
        <div className="ow-cardprev-top"><BrandIcon className="ow-cardprev-mark" inverse /><span>TREUEKARTE</span></div>
        <div className="ow-cardprev-biz"><strong>{businessName || "Dein Geschäft"}</strong><span>{locationName}</span></div>
        <div className="ow-cardprev-bottom">AN DER KASSE ZEIGEN</div>
      </div>
      <div className="ow-cardprev-balance">
        <div className="ow-cardprev-line"><span>Dein Kontostand</span><strong className="ow-num">{balance} <em>{unit}</em></strong></div>
        <div className="ow-cardprev-reward"><strong>{rewardTitle || "Deine Prämie"}</strong><span className="ow-num">{shown} / {cost} {unit}</span></div>
        <div className="ow-cardprev-track" role="progressbar" aria-label={`Fortschritt zu ${rewardTitle}`} aria-valuenow={shown} aria-valuemin={0} aria-valuemax={cost}><span style={{ width: `${Math.round((shown / cost) * 100)}%`, backgroundColor: brandColor }} /></div>
        <p className="ow-muted" style={{ fontSize: 13 }}>{remaining === 0 ? "Prämie verfügbar. An der Kasse einlösen." : `Noch ${remaining} ${unit} bis zur Prämie.`}</p>
      </div>
    </div>
  );
}
