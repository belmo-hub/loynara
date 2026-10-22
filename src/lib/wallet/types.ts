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
  /** Merchant PNG logo for the Apple pass archive, only when it passed the size/format checks in logo.ts. */
  appleLogo?: { png: Buffer; width: number; height: number };
  googleLogoUrl?: string;
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
  reward?: { title: string; cost: number };
  lastActivityAt?: Date;
  /** The last owner message sent to this card (PassFast only), kept so a refresh resends it unchanged. */
  message?: string;
};

/** What a revoked pass may still show: who issued it and why it no longer works. No balance, QR code or locator. */
export type WalletRevokedData = WalletBrand & { membershipId: string; reason: RevokeReason };

/** Operator-side provider status. `reason` may name configuration keys: never send it to a browser. */
export type WalletStatus = { enabled: boolean; ready: boolean; reason: string | null };
