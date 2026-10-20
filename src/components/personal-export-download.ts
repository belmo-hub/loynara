/** Only a fully received, complete own-card export becomes a downloadable file. */
export async function readPersonalExport(url: string, body: object, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(failure?.code === "EXPORT_ASSISTANCE_REQUIRED" ? "Bitte wende dich für eine begleitete Datenauskunft an den Datenschutzkontakt deines Geschäfts. Teile dabei keinen privaten Kartenlink." : "Der Export ist nicht verfügbar. Öffne deine aktuelle Karte und fordere bei Bedarf einen neuen Link an.");
  }
  const blob = await response.blob();
  const data = JSON.parse(await blob.text());
  if (data?.formatVersion !== 2 || data.scope !== "complete-own-card-personal-data" || typeof data.membership?.id !== "string"
    || !["programContext", "ruleVersions", "rewardVersions", "ledger", "redemptions", "purchaseAwards", "contacts", "consentEvents", "securityEvents", "contactVerificationEvents", "exportProofEvents", "nfcOutcomes", "offlineLeases", "offlineOutcomes", "referralCodes", "referrals", "campaignParticipation", "campaignAttempts", "automationParticipation", "outboxOutcomes", "emailDeliveries", "emailProviderEvents", "emailSuppression", "walletPasses", "walletRegistrations", "inactivityReviews", "retentionExceptions"].every(name => Array.isArray(data[name]))) throw new Error("Der Export wurde nicht vollständig empfangen. Es wurde keine Datei vorbereitet. Bitte versuche es erneut.");
  return blob;
}
