import { z } from "zod";
import { DomainError } from "./loyalty";
import { getMerchantAnalytics, type AnalyticsWindowDays, type MerchantAnalytics } from "./merchant-analytics";

const observedMetricSchema = z.object({ label: z.string().min(1).max(80), value: z.number().int().min(0).max(1_000_000_000) }).strict();
const recommendationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  title: z.string().trim().min(4).max(100),
  observed: z.array(observedMetricSchema).min(1).max(4),
  reasoning: z.string().trim().min(10).max(300),
  missingInformation: z.array(z.string().trim().min(4).max(160)).min(1).max(3),
  nextAction: z.string().trim().min(10).max(220),
}).strict();

export type AdviceRecommendation = z.infer<typeof recommendationSchema>;
export type MerchantAdvice = {
  mode: "rule_based";
  windowDays: AnalyticsWindowDays;
  from: string;
  asOf: string;
  metrics: {
    currentActiveCards: number; newCards: number; qualifyingCheckouts: number;
    participatingCards: number; repeatCards: number; redemptions: number;
    campaignAttempts: number; failedOrBlockedAttempts: number;
  };
  recommendations: AdviceRecommendation[];
  limitations: string[];
};

function metrics(report: MerchantAnalytics): MerchantAdvice["metrics"] {
  return {
    currentActiveCards: report.currentActiveCards,
    newCards: report.newCards,
    qualifyingCheckouts: report.qualifyingCheckouts,
    participatingCards: report.participatingCards,
    repeatCards: report.repeatCards,
    redemptions: report.rewards.redemptions,
    campaignAttempts: report.campaignAttempts.total,
    failedOrBlockedAttempts: report.campaignAttempts.failed + report.campaignAttempts.blocked,
  };
}

/** Suggestions are read-only and derived from persisted, tenant-scoped activity. */
export function buildRuleBasedAdvice(report: MerchantAnalytics): AdviceRecommendation[] {
  const m = metrics(report);
  const suggestions: AdviceRecommendation[] = [];
  if (m.currentActiveCards === 0) suggestions.push({
    id: "enrolment_start", title: "Erste Karte im Betrieb prüfen",
    observed: [{ label: "Aktive Karten", value: 0 }, { label: "Neue Karten", value: m.newCards }],
    reasoning: "Ohne aktive Karte lässt sich noch kein digitaler Kassenablauf auswerten.",
    missingInformation: ["Papierkarten und nicht erfasste Besuche sind hier nicht enthalten."],
    nextAction: "Mit einer eigenen Karte die Anmeldung und den Kassenablauf im Team durchgehen.",
  });
  else if (m.qualifyingCheckouts === 0) suggestions.push({
    id: "checkout_flow", title: "Ersten Kassenvorgang prüfen",
    observed: [{ label: "Aktive Karten", value: m.currentActiveCards }, { label: "Bestätigte Kassenvorgänge", value: 0 }],
    reasoning: "Bei vorhandenen Karten und 0 bestätigten Kassenvorgängen ist der digitale Ablauf noch nicht belegt.",
    missingInformation: ["Papierkäufe und nicht erfasste Besuche sind unbekannt."],
    nextAction: "Mit einer eigenen Karte einen bestätigten Kassenvorgang und den neuen Saldo prüfen.",
  });
  if (m.failedOrBlockedAttempts > 0) suggestions.push({
    id: "delivery_failures", title: "Zustellfehler prüfen",
    observed: [{ label: "Zustellversuche", value: m.campaignAttempts }, { label: "Fehlgeschlagen oder blockiert", value: m.failedOrBlockedAttempts }],
    reasoning: "Mindestens ein erfasster Zustellversuch ist fehlgeschlagen oder blockiert.",
    missingInformation: ["Ein Annahmestatus beweist keine Zustellung in ein echtes Postfach."],
    nextAction: "Die betroffenen Kampagnenversuche und Unterdrückungsgründe prüfen, bevor ein weiterer Test geplant wird.",
  });
  if (m.participatingCards >= 5 && m.repeatCards * 4 < m.participatingCards) suggestions.push({
    id: "repeat_participation", title: "Wiederkehrende Teilnahme ansehen",
    observed: [{ label: "Karten mit Kassenvorgang", value: m.participatingCards }, { label: "Mit mindestens zwei Vorgängen", value: m.repeatCards }],
    reasoning: "Weniger als ein Viertel der teilnehmenden Karten hat im gewählten Zeitraum mindestens zwei bestätigte Kassenvorgänge.",
    missingInformation: ["Die Daten zeigen keine Kaufhäufigkeit außerhalb dieser digitalen Karte und keine Ursache für Wiederkehr."],
    nextAction: "Das Prämienziel und den Kassenablauf mit dem Team ansehen; Änderungen erst nach eigener Prüfung vornehmen.",
  });
  if (m.qualifyingCheckouts >= 3 && m.redemptions === 0) suggestions.push({
    id: "reward_path", title: "Prämienweg prüfen",
    observed: [{ label: "Bestätigte Kassenvorgänge", value: m.qualifyingCheckouts }, { label: "Einlösungen", value: 0 }],
    reasoning: "Bei mindestens drei bestätigten Kassenvorgängen ist im Zeitraum keine Einlösung erfasst.",
    missingInformation: ["Der Bericht zeigt nicht, ob einzelne Karten bereits genug Guthaben für eine Prämie haben."],
    nextAction: "Prämienkosten, Kartentexte und den Einlösevorgang im Programm prüfen.",
  });
  if (suggestions.length === 0) suggestions.push({
    id: "monitor_trend", title: "Verlauf weiter beobachten",
    observed: [{ label: "Bestätigte Kassenvorgänge", value: m.qualifyingCheckouts }, { label: "Einlösungen", value: m.redemptions }],
    reasoning: "Die festen Prüfregeln haben im gewählten Zeitraum keinen konkreten Handlungsbedarf ausgelöst.",
    missingInformation: ["Die App kennt keine Verkäufe außerhalb der erfassten Vorgänge und keine inkrementelle Wirkung."],
    nextAction: "Den 30- und 90-Tage-Verlauf vergleichen und bei Bedarf eine konkrete Regel manuell prüfen.",
  });
  return suggestions.slice(0, 3);
}

export async function getMerchantAdvice(actorUserId: string, options: { windowDays: AnalyticsWindowDays; asOf?: Date }): Promise<MerchantAdvice> {
  const report = await getMerchantAnalytics(actorUserId, options);
  return {
    mode: "rule_based", windowDays: report.windowDays, from: report.from, asOf: report.asOf,
    metrics: metrics(report), recommendations: buildRuleBasedAdvice(report),
    limitations: [
      "Die Vorschläge beruhen nur auf bestätigten Vorgängen dieses Händlers und dem gewählten Zeitraum.",
      "Erfasste Aktivität beweist keine zusätzlichen Verkäufe.",
      "Die Beratung ändert nichts an deinem Programm, deinen Prämien oder deinen Kosten.",
    ],
  };
}

export type AdviceModelRequest = {
  summary: MerchantAdvice["metrics"] & { windowDays: AnalyticsWindowDays };
  maxOutputTokens: 512;
  timeoutMs: 10_000;
};
export type AdviceModelProvider = {
  id: string;
  inputCostPerMillionMinor: number;
  outputCostPerMillionMinor: number;
  generate(request: AdviceModelRequest): Promise<unknown>;
};
export type ModelAdvicePolicy = { enabled: boolean; approvedForRun: boolean; maxCostMinor: number };

const modelOutputSchema = z.object({ recommendations: z.array(recommendationSchema).min(1).max(3) }).strict();
const boundedCount = z.number().int().min(0).max(1_000_000_000);
const modelSummarySchema = z.object({
  currentActiveCards: boundedCount, newCards: boundedCount, qualifyingCheckouts: boundedCount,
  participatingCards: boundedCount, repeatCards: boundedCount, redemptions: boundedCount,
  campaignAttempts: boundedCount, failedOrBlockedAttempts: boundedCount,
  windowDays: z.union([z.literal(30), z.literal(90)]),
}).strict();

/** Internal provider contract only. No provider is configured or called by the merchant route. */
export async function runModelAdvice(input: { report: MerchantAnalytics; provider: AdviceModelProvider; policy: ModelAdvicePolicy }) {
  if (!input.policy.enabled) throw new DomainError("MODEL_DISABLED", "Model advice is disabled");
  if (!input.policy.approvedForRun) throw new DomainError("APPROVAL_REQUIRED", "Approval is required for this model run");
  const { provider, policy } = input;
  if (!Number.isSafeInteger(provider.inputCostPerMillionMinor) || provider.inputCostPerMillionMinor < 0 ||
    !Number.isSafeInteger(provider.outputCostPerMillionMinor) || provider.outputCostPerMillionMinor < 0 ||
    !Number.isSafeInteger(policy.maxCostMinor) || policy.maxCostMinor < 0) throw new DomainError("MODEL_BUDGET", "Invalid model budget");
  const summary = modelSummarySchema.safeParse({ ...metrics(input.report), windowDays: input.report.windowDays });
  if (!summary.success) throw new DomainError("MODEL_INPUT_INVALID", "Model input is invalid");
  const request: AdviceModelRequest = { summary: summary.data, maxOutputTokens: 512, timeoutMs: 10_000 };
  const inputBytes = Buffer.byteLength(JSON.stringify(request.summary), "utf8");
  if (inputBytes > 4_096) throw new DomainError("MODEL_INPUT_TOO_LARGE", "Model input is too large");
  // Price the fixed 1,024-input/512-output-token envelope before any call.
  const worstCaseCostMinor = Math.ceil((1_024 * provider.inputCostPerMillionMinor + 512 * provider.outputCostPerMillionMinor) / 1_000_000);
  if (worstCaseCostMinor > policy.maxCostMinor) throw new DomainError("MODEL_BUDGET", "Model call exceeds the approved budget");
  const raw = await provider.generate(request);
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("MODEL_OUTPUT_INVALID", "Provider returned invalid advice");
  return { mode: "model" as const, providerId: provider.id, recommendations: parsed.data.recommendations, worstCaseCostMinor };
}
