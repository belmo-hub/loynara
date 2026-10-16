"use client";

import type { CSSProperties } from "react";
import { CardFace } from "@/components/customer/card-face";
import { merchantPalette } from "@/components/ui/merchant-color";

export type CardPreviewProps = {
  businessName: string;
  locationName: string;
  brandColor: string;
  programType: "stamp" | "points";
  rewardTitle: string;
  rewardCost: number;
  balance: number;
};

const SAMPLE_LOCATOR = "K-7QX2MA";

/** Decorative placeholder only: not a scannable code. */
export function CodeMock({ caption }: { caption?: string }) {
  const cells = Array.from({ length: 49 }, (_, index) => ((index * 7 + Math.floor(index / 7) * 3) % 5) < 2);
  return <div className="ow-pass-codewrap"><svg className="ow-pass-code" viewBox="0 0 7 7" aria-hidden="true" focusable="false">{cells.map((on, index) => on ? <rect key={index} x={index % 7} y={Math.floor(index / 7)} width="1" height="1" /> : null)}</svg>{caption ? <span className="ow-pass-alt">{caption}</span> : null}</div>;
}

/**
 * The guest's real card face (the same component as on the card page) in the colour being edited, with a sample
 * card number and a placeholder code. `showCode` false leaves out the code ticket where space is short.
 */
export function BrowserCardPreview({ businessName, locationName, brandColor, programType, rewardTitle, rewardCost, balance, showCode = true }: CardPreviewProps & { showCode?: boolean }) {
  const palette = merchantPalette(brandColor, "light");
  const reward = { id: "preview", title: rewardTitle || "Deine Prämie", cost: Math.max(1, rewardCost) };
  return <div className="ow-cardprev" style={palette.cssVars as CSSProperties}>
    <CardFace className="ow-cardprev-face" businessName={businessName || "Dein Geschäft"} locationName={locationName} programType={programType === "points" ? "points" : "stamps"} balance={balance} rewards={[reward]} selected={reward}>
      {showCode ? <div className="ow-cardprev-ticket"><CodeMock /><p className="ow-cardprev-number"><span>Kartennummer</span><strong>{SAMPLE_LOCATOR}</strong></p></div> : null}
    </CardFace>
  </div>;
}
