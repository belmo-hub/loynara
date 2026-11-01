import type { RulePending } from "@/lib/rule-versions";
export type WalletLocale = "de" | "fr";
export type WalletProvider = "apple" | "google";
export type RevokeReason = "reissued" | "closed" | "superseded";

/** Merchant and programme presentation shared by every pass of a programme, valid or revoked. */
export type WalletBrand = {
  programType?: "stamp" | "points";
  tenantId: string;
  /** Database-resolved programme location. Legacy native fixture builders may omit it. */
  locationId?: string;
  programId: string;
  merchantName: string;
  programName: string;
  locationName: string;
  brandColor: string;
  country: string;
  locale: WalletLocale;
  /** Merchant logo for the Apple pass archive, processed in logo-process.ts; absent means the name stands alone. */
  appleLogo?: AppleLogo;
  /** Google's round programLogo: the square mark or the shop's initial. */
  googleLogoUrl?: string;
  /** Google's wideProgramLogo, only for a logo that is not square. */
  googleWideLogoUrl?: string;
  latitude?: number;
  longitude?: number;
};

/**
 * Display copy of one OPEN card, read from the membership row and ledger at the moment a pass is built or refreshed.
 * Nothing here is ever read back from a provider.
 */
export type WalletPassData = WalletBrand & {
  membershipId: string;
  programType: "stamp" | "points";
  balance: number;
  scanCode: string;
  /** Formatted staff locator, e.g. "K-7QX2MA". Not a credential. */
  cardLocator: string;
  /** The card's target reward (the first by the merchant's order, as on the browser card). */
  reward?: { title: string; cost: number;
    /** ENG-100: a dated change and the archive date (YYYY-MM-DD, location time), data only until the pass shows them. */
    pending?: { effectiveOn: string; title: string; cost: number } | null; endsOn?: string | null };
  /** Every active reward in the merchant's order, for the list on the back of the Apple pass (ENG-116). */
  rewards?: Array<{ title: string; cost: number }>;
  /** The programme rules as the sign-up page lists them (signUpRules), one paragraph each, for the back of the Apple pass. */
  rules?: string[];
  lastActivityAt?: Date;
  /** The last owner message sent to this card, kept so a refresh resends it unchanged; "" for a card that allowed messages and has none yet. */
  message?: string;
  /** The day that message was sent, „28.10.“ in the shop's timezone. */
  messageDay?: string;
  /** Without message consent the field is the expiry-only one (ENG-162, Legal): its own key and wording, expiry notices only. */
  messageKey?: "expiry";
  /** ENG-100: a waiting rule or expiry change (YYYY-MM-DD, location time), data only until the pass back shows them. */
  pending?: RulePending | null;
  pendingExpiry?: { effectiveOn: string; months: number; before: number | null } | null;
};

/** What a revoked pass may still show: who issued it and why it no longer works. No balance, QR code or locator. */
export type WalletRevokedData = WalletBrand & { membershipId: string; reason: RevokeReason };

/** Operator-side provider status. `reason` may name configuration keys: never send it to a browser. */
export type WalletStatus = { enabled: boolean; ready: boolean; reason: string | null };

export type AppleLogo = { png1x: Buffer; png2x: Buffer; png3x: Buffer; width: number; height: number; icon?: [Buffer, Buffer, Buffer]; showName: boolean };
