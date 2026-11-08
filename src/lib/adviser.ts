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

// Design's Beratung drafts (6 Nov) and Marketing F4c/F8 (7 Nov). A count keeps its unit on a line break.
const cardCount = (n: number) => `${n}\u00a0${n === 1 ? "Karte" : "Karten"}`;
const PROGRAM_LINK = { label: "Programm öffnen", href: "/merchant/program" };

/** Suggestions are read-only and derived from persisted, tenant-scoped activity. */
export function buildRuleBasedAdvice(report: MerchantAnalytics, retention?: RetentionSummary): AdviceRecommendation[] {
  const m = metrics(report);
  const suggestions: AdviceRecommendation[] = [];
  const r = retention;
  if (m.currentActiveCards === 0) suggestions.push({
    id: "enrolment_start", title: "Melde die erste Karte an",
    observed: [{ label: "Aktive Karten", value: 0 }, { label: "Neue Karten", value: m.newCards }],
    reasoning: "Noch gibt es keine aktive Karte.",
    missingInformation: ["Papierkarten zählen hier nicht."],
    nextAction: "Meld dich selbst an und geh die Kasse einmal mit deinem Team durch.",
  });
  else if (m.qualifyingCheckouts === 0) suggestions.push({
    id: "checkout_flow", title: "Erste Buchung testen",
    observed: [{ label: "Aktive Karten", value: m.currentActiveCards }, { label: "Bestätigte Buchungen", value: 0 }],
    reasoning: "Es gibt Karten, aber noch keine bestätigte Buchung.",
    missingInformation: ["Papierkäufe und nicht erfasste Besuche sind unbekannt."],
    nextAction: "Leg dir selbst eine Karte an, lass eine Buchung bestätigen und schau, ob der neue Stand stimmt.",
  });
  if (r && r.rewardReady > 0) suggestions.push({
    id: "reward_waiting", title: `Prämie verdient: ${cardCount(r.rewardReady)}`,
    observed: [{ label: "Karten mit verdienter Prämie", value: r.rewardReady }, { label: "Einlösungen im Zeitraum", value: m.redemptions }],
    reasoning: "Ihr Stand reicht schon für die günstigste Prämie.",
    missingInformation: ["Ob jemand bewusst spart, sehen wir nicht."],
    nextAction: "Bitte dein Team, die Prämie beim nächsten Besuch anzubieten.",
    link: { label: "Karten ansehen", href: retentionCustomerHref(r, "reward_ready") },
  });
  if (r && r.drifting >= 3 && r.drifting > r.driftingWeekAgo) suggestions.push({
    id: "lapsed_growing", title: "Mehr Karten bleiben weg",
    observed: [{ label: `Ohne Buchung seit ${r.inactiveDays}+ Tagen`, value: r.drifting }, { label: "Vor einer Woche", value: r.driftingWeekAgo }],
    reasoning: `Mehr Karten als vor einer Woche sind seit über ${r.inactiveDays} Tagen weg.`,
    missingInformation: ["Warum, wissen wir nicht.", "Käufe ohne Karte fehlen hier."],
    nextAction: "Schau dir die Karten an und entscheide, ob der Willkommen-zurück-Bonus passt.",
    link: { label: "Länger nicht da", href: retentionCustomerHref(r, "drifting") },
  });
  if (r && r.neverAfterWeek >= 3 && r.neverAfterWeek * 4 >= r.openCards) suggestions.push({
    id: "signup_not_stamped", title: `Noch nie an der Kasse: ${cardCount(r.neverAfterWeek)}`,
    observed: [{ label: "Seit über 7 Tagen ohne Buchung", value: r.neverAfterWeek }, { label: "Alle Karten", value: r.openCards }],
    reasoning: "Mindestens ein Viertel der Karten hat nach über einer Woche noch keine Buchung.",
    missingInformation: ["Ob jemand nicht wiederkam oder nicht gescannt wurde, sehen wir nicht."],
    nextAction: "Erinnere dein Team daran, jede Karte beim Bezahlen zu scannen oder per Kartennummer zu suchen.",
    link: { label: "Karten ansehen", href: retentionCustomerHref(r, "never", 7) },
  });
  if (m.failedOrBlockedAttempts > 0) suggestions.push({
    id: "delivery_failures", title: "E-Mails kamen nicht an",
    observed: [{ label: "Zustellversuche", value: m.campaignAttempts }, { label: "Fehlgeschlagen oder blockiert", value: m.failedOrBlockedAttempts }],
    reasoning: "Mindestens ein Versand ist fehlgeschlagen.",
    missingInformation: ["Angenommen heißt nicht, dass die E-Mail im Postfach ankam."],
    nextAction: "Prüf in den Kampagnen, was nicht rausging, bevor du neu sendest.",
  });
  if (m.participatingCards >= 5 && m.repeatCards * 4 < m.participatingCards) suggestions.push({
    id: "repeat_participation", title: "Wenige Karten mit zweiter Buchung",
    observed: [{ label: "Karten mit Buchung", value: m.participatingCards }, { label: "Mit mindestens zwei Buchungen", value: m.repeatCards }],
    reasoning: "Weniger als ein Viertel der Karten hatte im Zeitraum zwei oder mehr Buchungen.",
    missingInformation: ["Käufe ohne Karte und die Gründe kennt Loynara nicht."],
    nextAction: "Prüf, ob die erste Prämie zu weit weg ist, und frag dein Team, ob jede Karte gescannt wird.",
    link: PROGRAM_LINK,
  });
  if (m.qualifyingCheckouts >= 3 && m.redemptions === 0 && !(r && r.rewardReady > 0)) suggestions.push({
    id: "reward_path", title: "Keine Prämie im Zeitraum eingelöst",
    observed: [{ label: "Bestätigte Buchungen", value: m.qualifyingCheckouts }, { label: "Einlösungen", value: 0 }],
    // Without the retention read nobody knows whether a card already has enough: the live line says so.
    reasoning: r ? "Noch hat keine Karte genug. Der Weg zur Prämie könnte zu lang sein." : "Mindestens drei bestätigte Buchungen, aber im Zeitraum keine eingelöste Prämie.",
    missingInformation: [r ? "Warum, wissen wir nicht." : "Der Bericht zeigt nicht, ob einzelne Karten bereits genug Guthaben für eine Prämie haben."],
    nextAction: "Schau im Programm, ob die günstigste Prämie zu teuer ist.",
    link: PROGRAM_LINK,
  });
  if (suggestions.length === 0) suggestions.push({
    id: "monitor_trend", title: "Gerade fällt nichts auf",
    observed: [{ label: "Bestätigte Buchungen", value: m.qualifyingCheckouts }, { label: "Einlösungen", value: m.redemptions }],
    reasoning: "Im Zeitraum gibt es nichts zu tun.",
    missingInformation: ["Verkäufe ohne Karte und die Wirkung der Karte auf deinen Umsatz kennt Loynara nicht."],
    nextAction: "Schau nächste Woche wieder rein.",
  });
  // E-mail campaigns are withheld on the pilot (pilot-surfaces), so their delivery hint ranks last (Design, 6 Nov).
  const email = suggestions.filter(item => item.id === "delivery_failures");
  return [...suggestions.filter(item => item.id !== "delivery_failures"), ...email].slice(0, 4);
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
