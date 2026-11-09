import { REWARD_COST_MAX } from "@/lib/points";
import { SHOP_TEMPLATES } from "@/lib/shop-templates";

/**
 * The Demo-Modus form's state, kept pure so its rules are tested without a browser. `key` is the client key of the
 * start being sent: kept for a retry after a lost answer, dropped after any edit (outside a send), and the whole form
 * goes back to empty after a start, so a stray second tap stops at the empty name.
 */
export type DemoForm = { templateId: string; name: string; colour: string; reward: string; cost: string; logoData?: string; logoError: string; logoBusy: boolean; key: string | null; sending: boolean };
export type DemoFormAction =
  | { type: "template"; id: string }
  | { type: "edit"; patch: Partial<Pick<DemoForm, "name" | "colour" | "reward" | "cost">> }
  | { type: "logo"; logoData?: string; logoError?: string; logoBusy?: boolean }
  | { type: "send"; key: string }
  | { type: "failed" }
  | { type: "started" };

const fromTemplate = (id: string) => {
  const t = SHOP_TEMPLATES.find(template => template.id === id) ?? SHOP_TEMPLATES[0];
  return { templateId: t.id, colour: t.colours[0], reward: t.rewardTitle, cost: String(t.cost) };
};

export const initialDemoForm = (): DemoForm => ({ ...fromTemplate(SHOP_TEMPLATES[0].id), name: "", logoError: "", logoBusy: false, key: null, sending: false });

export function demoForm(state: DemoForm, action: DemoFormAction): DemoForm {
  // An edit while a start is on its way keeps its key: the retry must not make a second shop.
  const key = state.sending ? state.key : null;
  switch (action.type) {
    case "template": return { ...state, ...fromTemplate(action.id), key };
    case "edit": return { ...state, ...action.patch, key };
    case "logo": return { ...state, logoData: action.logoData, logoError: action.logoError ?? "", logoBusy: action.logoBusy ?? false, key };
    case "send": return { ...state, key: action.key, sending: true };
    case "failed": return { ...state, sending: false };
    case "started": return initialDemoForm();
  }
}

export const COST_PROBLEM = `Gib eine ganze Zahl von 1 bis ${REWARD_COST_MAX.toLocaleString("de-DE")} ein.`;
/** The cost field's own check, the server's limit. */
export const costProblem = (cost: string) => /^\d+$/.test(cost.trim()) && Number(cost) >= 1 && Number(cost) <= REWARD_COST_MAX ? "" : COST_PROBLEM;
