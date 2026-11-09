// Shop-type templates (demo-mode design §7): editable starting points, first for the demo form. Pure, so client code may
// import it. The wording in the data file is a draft until the founder approves it.
import data from "@/content/shop-templates.json";
import { happyHourProblem, type HappyHourWindow } from "./happy-hour";
import { MAX_POINTS_PER_CURRENCY_UNIT, REWARD_COST_MAX } from "./points";
import { checkMessageText, contentRefusal, WINBACK_DAYS, winbackBonusMax } from "./wallet-message-rules";

export type ShopTemplate = {
  id: string; label: string; programType: "stamp" | "points"; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit?: number;
  cost: number; rewardTitle: string; headline: string; colours: string[];
  suggestions: { winback: { days: number; bonus: number }; birthday: { bonus: number }; happyHour: HappyHourWindow | null };
  exampleMessage: string;
};

export const SHOP_TEMPLATES = data.templates as ShopTemplate[];

const HEX = /^#[0-9a-fA-F]{6}$/;
const whole = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** Why a template could not be offered, checked against the limits the server applies; empty when it is fine. */
export function templateProblems(t: ShopTemplate): string[] {
  const problems: string[] = [];
  const stamp = t.programType === "stamp";
  if (!t.id || !t.label) problems.push("id and label are required");
  if (stamp && t.earningMode !== "manual") problems.push("stamp cards earn manually");
  if (t.earningMode === "purchase" && !whole(t.pointsPerCurrencyUnit, 1, MAX_POINTS_PER_CURRENCY_UNIT)) problems.push("pointsPerCurrencyUnit out of range");
  if (!whole(t.cost, 1, REWARD_COST_MAX)) problems.push("cost out of range");
  const title = t.rewardTitle.trim();
  if (title.length < 2 || title.length > 180) problems.push("rewardTitle length");
  const refused = contentRefusal(title);
  if (refused) problems.push(`rewardTitle: ${refused}`);
  if (!t.headline.trim()) problems.push("headline is required");
  if (!t.colours.length || !t.colours.every(hex => HEX.test(hex))) problems.push("colours must be #RRGGBB");
  const message = checkMessageText(t.exampleMessage);
  if (!message.ok) problems.push(`exampleMessage: ${message.error}`);
  const bonusMax = winbackBonusMax(t.programType, t.cost); // the birthday bonus has the same limit (birthday.ts)
  const { winback, birthday, happyHour } = t.suggestions;
  if (!whole(winback.days, WINBACK_DAYS.min, WINBACK_DAYS.max)) problems.push("winback days out of range");
  if (!whole(winback.bonus, 0, bonusMax)) problems.push("winback bonus out of range");
  if (!whole(birthday.bonus, 0, bonusMax)) problems.push("birthday bonus out of range");
  if (happyHour && (stamp || happyHourProblem([happyHour]))) problems.push("happy hour needs a points card and a valid window");
  return problems;
}

/** The programme fields a template fills in, as the onboard request names them. Shop name, place and rules text come
 *  from the form that uses it. */
export function templateProgramme(t: ShopTemplate) {
  return { programType: t.programType, earningMode: t.earningMode, pointsPerCurrencyUnit: t.pointsPerCurrencyUnit ?? 1, rewardTitle: t.rewardTitle, rewardCost: t.cost, brandColor: t.colours[0] };
}
