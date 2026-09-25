export type WalletPassData = {
  tenantId: string;
  membershipId: string;
  programId: string;
  merchantName: string;
  programName: string;
  locationName: string;
  programType: "stamp" | "points";
  balance: number;
  scanCode: string;
  brandColor: string;
  country: string;
  latitude?: number;
  longitude?: number;
};

export type WalletStatus = { enabled: boolean; ready: boolean; reason: string | null };
