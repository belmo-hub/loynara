// Geschäft's sender screens (ENG-164): no client code, so the route and the screens share one list.
export type SenderQuestion = "anschrift" | "kontakt" | "vertretung" | "register";
export const SENDER_QUESTIONS: readonly SenderQuestion[] = ["anschrift", "kontakt", "vertretung", "register"];
export const isSenderQuestion = (value: string): value is SenderQuestion => (SENDER_QUESTIONS as readonly string[]).includes(value);
export const senderHref = (question: SenderQuestion) => `/merchant/settings/absender/${question}`;
