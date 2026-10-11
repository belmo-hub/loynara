import { z } from "zod";
import { pool } from "@/db";
import { DomainError } from "./loyalty";
import { getMerchantAnalytics, type AnalyticsWindowDays, type MerchantAnalytics } from "./merchant-analytics";
import { retentionCustomerHref } from "./retention-links";
import { getRetentionSummary, type RetentionSummary } from "./retention";

const observedMetricSchema = z.object({ label: z.string().min(1).max(80), value: z.number().int().min(0).max(1_000_000_000) }).strict();
const recommendationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  title: z.string().trim().min(4).max(100),
  observed: z.array(observedMetricSchema).min(1).max(4),
  reasoning: z.string().trim().min(10).max(300),
  missingInformation: z.array(z.string().trim().min(4).max(160)).min(1).max(3),
  nextAction: z.string().trim().min(10).max(220),
}).strict();

/** Deterministic advice may carry a link to the page where the owner can check it; model output never does. */
export type AdviceRecommendation = z.infer<typeof recommendationSchema> & { link?: { label: string; href: string } };
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
export function buildRuleBasedAdvice(report: MerchantAnalytics, retention?: RetentionSummary): AdviceRecommendation[] {
  const m = metrics(report);
  const suggestions: AdviceRecommendation[] = [];
  const r = retention;
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
  if (r && r.rewardReady > 0) suggestions.push({
    id: "reward_waiting", title: "Prämien sind jetzt einlösbar",
    observed: [{ label: "Karten mit verdienter Prämie", value: r.rewardReady }, { label: "Einlösungen im Zeitraum", value: m.redemptions }],
    reasoning: "Der aktuelle Kartenstand reicht für die günstigste aktive Prämie. Ob und wann vorher Prämien eingelöst wurden, sagt dieser Bestand nicht.",
    missingInformation: ["Ob die Person die Prämie kennt oder bewusst spart, zeigen die Daten nicht."],
    nextAction: "Dein Team bitten, die Prämie beim nächsten Besuch aktiv anzubieten; die Karten stehen unter Kunden.",
    link: { label: "Karten mit verdienter Prämie", href: retentionCustomerHref(r, "reward_ready") },
  });
  if (r && r.drifting >= 3 && r.drifting > r.driftingWeekAgo) suggestions.push({
    id: "lapsed_growing", title: "Mehr Karten bleiben weg",
    observed: [{ label: `Ohne Kassenvorgang seit ${r.inactiveDays}+ Tagen`, value: r.drifting }, { label: "Vor einer Woche", value: r.driftingWeekAgo }],
    reasoning: `Die Zahl der Karten mit früheren bestätigten Kassenvorgängen und keinem erfassten Vorgang seit über ${r.inactiveDays} Tagen ist binnen einer Woche gestiegen.`,
    missingInformation: ["Warum jemand nicht mehr kommt (Urlaub, Umzug, Konkurrenz), weiß Loynara nicht.", "Besuche ohne vorgezeigte Karte fehlen in den Daten."],
    nextAction: "Die betroffenen Karten ansehen und entscheiden, ob eine Rückhol-Aktion passt.",
    link: { label: "Länger nicht da", href: retentionCustomerHref(r, "drifting") },
  });
  if (r && r.neverAfterWeek >= 3 && r.neverAfterWeek * 4 >= r.openCards) suggestions.push({
    id: "signup_not_stamped", title: "Anmeldungen ohne Kassenvorgang",
    observed: [{ label: "Seit über 7 Tagen ohne Kassenvorgang", value: r.neverAfterWeek }, { label: "Offene Karten", value: r.openCards }],
    reasoning: "Mindestens ein Viertel der Karten wurde vor über einer Woche angelegt, aber nie an der Kasse bestätigt.",
    missingInformation: ["Ob die Person nicht wiederkam oder an der Kasse nicht gestempelt wurde, ist nicht unterscheidbar."],
    nextAction: "Mit dem Team kurz durchgehen, dass jede Karte beim Bezahlen gescannt oder per Kartennummer gesucht wird.",
    link: { label: "Noch nie an der Kasse", href: retentionCustomerHref(r, "never", 7) },
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
  if (m.qualifyingCheckouts >= 3 && m.redemptions === 0 && !(r && r.rewardReady > 0)) suggestions.push({
    id: "reward_path", title: "Prämienweg prüfen",
    observed: [{ label: "Bestätigte Kassenvorgänge", value: m.qualifyingCheckouts }, { label: "Einlösungen", value: 0 }],
    reasoning: "Bei mindestens drei bestätigten Kassenvorgängen ist im Zeitraum keine Einlösung erfasst.",
    missingInformation: [r ? "Noch hat keine Karte genug für eine Prämie; der Weg dorthin könnte zu lang sein." : "Der Bericht zeigt nicht, ob einzelne Karten bereits genug Guthaben für eine Prämie haben."],
    nextAction: "Prämienkosten, Kartentexte und den Einlösevorgang im Programm prüfen.",
  });
  if (suggestions.length === 0) suggestions.push({
    id: "monitor_trend", title: "Verlauf weiter beobachten",
    observed: [{ label: "Bestätigte Kassenvorgänge", value: m.qualifyingCheckouts }, { label: "Einlösungen", value: m.redemptions }],
    reasoning: "Die festen Prüfregeln haben im gewählten Zeitraum keinen konkreten Handlungsbedarf ausgelöst.",
    missingInformation: ["Die App kennt keine Verkäufe außerhalb der erfassten Vorgänge und keine inkrementelle Wirkung."],
    nextAction: "Den 30- und 90-Tage-Verlauf vergleichen und bei Bedarf eine konkrete Regel manuell prüfen.",
  });
  return suggestions.slice(0, 4);
}

export async function getMerchantAdvice(actorUserId: string, options: { windowDays: AnalyticsWindowDays; asOf?: Date }): Promise<MerchantAdvice> {
  const client = await pool.connect();
  let discardClient = false;
  try {
    // One response must derive counts and explanations from the same committed state.
    // Read-only MVCC keeps award writers free; no provider I/O runs in this transaction.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
    const report = await getMerchantAnalytics(actorUserId, options, client);
    const retention = await getRetentionSummary(actorUserId, { inactiveDays: 30, asOf: new Date(report.asOf) }, client);
    await client.query("COMMIT");
    return {
    mode: "rule_based", windowDays: report.windowDays, from: report.from, asOf: report.asOf,
    metrics: metrics(report), recommendations: buildRuleBasedAdvice(report, retention),
    limitations: [
      "Die Vorschläge beruhen nur auf bestätigten Vorgängen dieses Händlers und dem gewählten Zeitraum.",
      "Erfasste Aktivität beweist keine zusätzlichen Verkäufe.",
      "Die Beratung ändert nichts an deinem Programm, deinen Prämien oder deinen Kosten.",
    ],
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discardClient = true; }
    throw error;
  } finally { client.release(discardClient); }
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
