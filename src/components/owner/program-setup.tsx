"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { imageToDataUrl, postJson } from "@/components/client-api";
import { useOwner } from "./owner-context";
import { MerchantSetupView, type SetupInput } from "@/components/loyalty-ui";

/** First-run setup. Uses the existing onboarding endpoint unchanged. */
export function ProgramSetup() {
  const router = useRouter();
  const owner = useOwner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      await owner.refresh(); router.replace("/merchant");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Programm konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }
  return <MerchantSetupView saving={busy} error={error} onSubmit={submit} />;
}
